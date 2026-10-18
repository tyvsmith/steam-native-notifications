import { integrationRemoval } from './removal';
import { runtimeAsset } from './runtime-paths';
import { startControl } from './control';
import { controlHandler } from './control-host';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CDP, endpoint, targetSocket } from './cdp';
import { Host, requestPayload } from './host';
import { inspectEndpoint } from './diagnostics';
import { discoverSteam, setupPaths } from './paths';
import { acquireDaemonLock } from './lock';
import { healthExpression } from './health';
import { BUILD_IDENTITY } from '../shared/host';

export async function attach(client: CDP, bundle: string, host: Host, alive: () => boolean = () => true, initialContexts: number[] = []): Promise<void> {
    let context: number | undefined;
    let injected = false, stopped = false, enabled = false, generation = 0, busy = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const defaults = new Set<number>(initialContexts);
    let queue: Promise<unknown> = Promise.resolve();
    let finish!: () => void, fail!: (error: Error) => void;
    const done = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    // Initialization can fail before the lifecycle promise is awaited.
    void done.catch(() => {});
    const current = (epoch: number, id = context) => !stopped && alive() && epoch === generation && id !== undefined && id === context;
    const schedule = (operation: () => Promise<void>) => {
        if (!enabled) return;
        queue = queue.then(async () => { if (!stopped && alive()) await operation(); })
            .catch(error => { fail(error); }).finally(() => { if (!alive()) finish(); });
    };
    const resetControl = () => {
        generation++; context = undefined; injected = false;
        host.frontendCommand = undefined;
        Object.assign(host.live, { state: 'waiting-for-context', frontendBuild: null, hook: 'unknown', control: false });
    };
    let previousConfig = '';
    const push = async () => {
        const epoch = generation, id = context;
        if (!injected || !current(epoch, id)) return;
        const snapshot = await host.store.read();
        if (!current(epoch, id)) return;
        const encoded = JSON.stringify(snapshot.values);
        const panel = { config: snapshot, ...host.live,
            compatible: host.live.frontendBuild?.buildId === BUILD_IDENTITY.buildId && host.live.control === true };
        const result = await client.call('Runtime.evaluate', { contextId: id,
            expression: `${encoded !== previousConfig ? `globalThis.__snnConfig(${encoded});` : ''}globalThis.__snnState?.(${JSON.stringify(panel)})` });
        if (result.exceptionDetails) throw new Error('Frontend state update failed');
        if (current(epoch, id)) previousConfig = encoded;
    };
    const refresh = async () => {
        const epoch = generation, id = context;
        if (!injected || !current(epoch, id)) return;
        try {
            const probe = await client.call('Runtime.evaluate', { contextId: id, returnByValue: true, awaitPromise: true,
                expression: healthExpression(2 ** 52 + Math.floor(Math.random() * 1000000000)) });
            const info = await client.call('Runtime.evaluate', { contextId: id, returnByValue: true,
                expression: '({frontendBuild:globalThis.__snnFrontendBuild ?? null,hook:globalThis.__snnHookState ?? "unknown",panel:globalThis.__snnPanelState ?? "unavailable",control:typeof globalThis.__snnDevControl === "function"})' });
            if (!current(epoch, id)) return;
            if (probe.exceptionDetails || info.exceptionDetails) throw new Error('Frontend health evaluation failed');
            Object.assign(host.live, info.result?.value ?? {});
            host.live.state = probe.result?.value === true ? 'ready' : 'waiting-for-context';
            await push();
        } catch (error) {
            if (current(epoch, id)) Object.assign(host.live, { state: 'unresponsive', control: false });
            await host.log('standalone: frontend health check failed');
        }
    };
    host.refreshFrontend = () => {
        const operation = queue.then(refresh);
        queue = operation.catch(() => {});
        return operation;
    };
    const inject = async () => {
        if (injected) return;
        for (const candidate of defaults) {
            const epoch = generation;
            const probe = await client.call('Runtime.evaluate', { contextId: candidate, returnByValue: true,
                expression: 'Boolean(globalThis.g_PopupManager && globalThis.SteamClient)' });
            if (probe.result?.value !== true || generation !== epoch || !defaults.has(candidate)) continue;
            context = candidate;
            const values = await host.settings();
            if (!current(epoch, candidate)) continue;
            const result = await client.call('Runtime.evaluate', { contextId: candidate,
                expression: `if (!globalThis.__snnStandaloneStarted) { globalThis.__snnInitialConfig=${JSON.stringify(values)};\n${bundle}\n} globalThis.__snnConfig(${JSON.stringify(values)});` });
            if (!current(epoch, candidate) || !defaults.has(candidate)) continue;
            if (result.exceptionDetails) throw new Error(`Injection failed: ${result.exceptionDetails.text}`);
            injected = true; previousConfig = JSON.stringify(values);
            host.frontendCommand = async (envelope, sample) => {
                if (!current(epoch, candidate) || envelope.deadline <= Date.now()) throw new Error('Frontend changed or request expired');
                // Commands and config pushes share the same queue, preserving saved-config order.
                const operation = queue.then(async () => {
                    if (!current(epoch, candidate) || envelope.deadline <= Date.now()) throw new Error('Frontend changed or request expired');
                    const latest = await host.settings();
                    if (!current(epoch, candidate) || envelope.deadline <= Date.now()) throw new Error('Frontend changed or request expired');
                    const reply = await client.call('Runtime.evaluate', { contextId: candidate, returnByValue: true, awaitPromise: true,
                        expression: `globalThis.__snnConfig(${JSON.stringify(latest)}); globalThis.__snnDevControl ? globalThis.__snnDevControl(${JSON.stringify(envelope)},${sample}) : ({ok:false,error:"Older frontend lacks control support; restart Steam"})` });
                    if (!current(epoch, candidate)) throw new Error('Frontend changed or request expired');
                    if (reply.exceptionDetails || !reply.result?.value?.ok) throw new Error(reply.result?.value?.error ?? 'Frontend execution failed');
                    previousConfig = JSON.stringify(latest);
                    return reply.result.value.value;
                });
                queue = operation.catch(() => {});
                return operation;
            };
            await host.log('standalone: frontend attached to SharedJSContext');
            await refresh();
            // readiness is a host lifecycle notification, never a recurring health tick.
            void host.readiness(host.live.state).then(() => { if (!alive()) finish(); }).catch(fail);
            return;
        }
        // Retry only while Steam is creating a usable context.
        if (!stopped && alive() && !injected && !retry) retry = setTimeout(() => { retry = undefined; schedule(inject); }, 500);
    };
    client.onEvent = message => {
        if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault) {
            defaults.add(message.params.context.id); schedule(inject);
        }
        if (message.method === 'Runtime.executionContextsCleared') { defaults.clear(); resetControl(); schedule(inject); }
        if (message.method === 'Runtime.executionContextDestroyed') {
            defaults.delete(message.params.executionContextId);
            if (context === message.params.executionContextId) { resetControl(); schedule(inject); }
        }
        if (message.method !== 'Runtime.bindingCalled' || message.params.name !== '__snnHost' || message.params.executionContextId !== context || busy >= 64) return;
        const epoch = generation, id = context;
        busy++;
        void (async () => {
            try {
                const request = requestPayload(message.params.payload);
                let value = '', error: string | undefined;
                try {
                    if (request.method === 'PanelRemove') {
                        const capability = await client.call('Runtime.evaluate', { contextId: id,
                            returnByValue: true, expression: "typeof globalThis.__snnRemove === 'function'" });
                        if (capability.exceptionDetails || capability.result?.value !== true) throw new Error('Restart Steam before removing the integration.');
                    }
                    value = await host.dispatch(request.method, request.args);
                } catch (reason: any) { error = reason.message; }
                if (!current(epoch, id)) return;
                const reply = await client.call('Runtime.evaluate', { contextId: id, returnByValue: true,
                    expression: `${request.method === 'PanelRemove' && !error ? 'globalThis.__snnRemove();' : ''}typeof globalThis.__snnReply === 'function' && globalThis.__snnReply(${request.id},${JSON.stringify(value)},${JSON.stringify(error ?? null)})` });
                if (request.method === 'PanelRemove' && !error && !reply.exceptionDetails && reply.result?.value === true) host.removal?.acknowledged();
            } catch (error: any) { await host.log(`standalone: binding refused: ${error.message}`); }
            finally { busy--; if (!alive()) finish(); }
        })().catch(fail);
    };
    let unsubscribe: (() => void) | undefined;
    void client.closed.then(() => { if (stopped) return; stopped = true; resetControl(); fail(new Error('Steam CDP disconnected')); });
    try {
        unsubscribe = await host.store.subscribe(() => schedule(push));
        await client.call('Runtime.enable');
        await client.call('Runtime.addBinding', { name: '__snnHost' });
        enabled = true;
        schedule(inject);
        await done;
    } finally {
        stopped = true;
        if (retry) clearTimeout(retry);
        unsubscribe?.();
        client.onEvent = () => {};
        host.refreshFrontend = undefined;
        resetControl();
    }
}

/** Prefer explicit shared-context titles. Probe lower-priority UI pages only when
 * the shared target is absent or not ready, never attach by title alone.
 */
export async function connectSteamContext(targets: any[], port: number, connect = CDP.connect): Promise<{ client: CDP; contexts: number[] }> {
    const groups = [targets.filter(target => ['SharedJSContext', 'Steam Shared Context presented by Valve™'].includes(target?.title)),
        targets.filter(target => ['Steam', 'SP'].includes(target?.title))];
    for (const group of groups) {
        const ready: Array<{ client: CDP; contexts: number[] }> = [];
        try {
            for (const target of group) {
                const socket = targetSocket(target, port);
                if (!socket) continue;
                let candidate: CDP | undefined;
                try {
                    candidate = await connect(socket);
                    const contexts = new Set<number>();
                    candidate.onEvent = event => {
                        if (event.method === 'Runtime.executionContextCreated' && event.params.context.auxData?.isDefault) contexts.add(event.params.context.id);
                        if (event.method === 'Runtime.executionContextsCleared') contexts.clear();
                        if (event.method === 'Runtime.executionContextDestroyed') contexts.delete(event.params.executionContextId);
                    };
                    await candidate.call('Runtime.enable');
                    const matched: number[] = [];
                    for (const id of contexts) {
                        const probe = await candidate.call('Runtime.evaluate', { contextId: id, returnByValue: true,
                            expression: 'Boolean(globalThis.g_PopupManager && globalThis.SteamClient)' });
                        if (probe.result?.value === true && contexts.has(id)) matched.push(id);
                    }
                    if (matched.length) { ready.push({ client: candidate, contexts: matched }); candidate = undefined; }
                } catch { /* a dying or not-yet-ready target will be rediscovered */ }
                finally { candidate?.close(); }
            }
            if (ready.length > 1) throw new Error('Multiple Steam shared contexts are ready; refusing ambiguous injection');
            if (ready.length === 1) return ready[0]!;
        } catch (error) { for (const result of ready) result.client.close(); throw error; }
    }
    throw new Error('Steam shared context is not ready');
}

export async function daemonMain(): Promise<void> {
    if (process.argv.includes('--help')) {
        console.log('Usage: bun standalone/daemon.ts [--port N] [--config FILE] [--steam-dir DIR]\nLinux experimental RT3 host. Steam must already expose its loopback DevTools port.'); return;
    }
    if (process.platform !== 'linux') throw new Error('Standalone RT3 host currently supports native Linux only');
    const options: Record<string, string> = {};
    for (let i = 2; i < process.argv.length; i += 2) {
        const key = process.argv[i]!;
        if (!['--port', '--config', '--steam-dir'].includes(key) || !process.argv[i + 1]) throw new Error(`Unknown or incomplete option: ${key}`);
        options[key] = process.argv[i + 1]!;
    }
    const port = Number(options['--port'] ?? '8080');
    endpoint(port);
    const paths = setupPaths();
    const runtime = join(paths.cacheHome, 'steam-native-notifications');
    const config = options['--config'] ?? paths.config;
    const host = new Host(runtime, config, await discoverSteam(paths, options['--steam-dir']), join(paths.stateHome, 'steam-native-notifications'));
    let bundle: string;
    try { bundle = await readFile(runtimeAsset('dist/standalone/frontend.js'), 'utf8'); }
    catch { throw new Error('Missing standalone build; run bun install --frozen-lockfile && bun run build:standalone in this checkout.'); }
    await host.initialize();
    const release = await acquireDaemonLock(runtime);
    let stopControl: (() => Promise<void>) | undefined;
    try {
        stopControl = await startControl(controlHandler(host), undefined, { exclusiveLock: release });
        let running = true;
        let client: CDP | undefined;
        const stop = () => { running = false; client?.close(); host.stop(); };
        host.removal = integrationRemoval(stop, paths);
        for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, stop);
        let previousFailure = '';
        while (running) {
            try {
                const inspection = await inspectEndpoint(port);
                if (inspection.kind !== 'steam') throw new Error(inspection.message);
                const selected = await connectSteamContext(inspection.targets!, port);
                client = selected.client; previousFailure = '';
                await attach(client, bundle, host, () => running, selected.contexts);
            } catch (error: any) {
                if (running && error.message !== previousFailure) { previousFailure = error.message; console.error(`Waiting for Steam: ${error.message}`); await host.log(`standalone: waiting: ${error.message}`); }
            } finally { client?.close(); client = undefined; host.frontendCommand = undefined; host.live.frontendBuild = null; await host.readiness('disconnected'); }
            if (running) await Bun.sleep(2000);
        }
    } finally { await stopControl?.(); await release(); }
}
if (import.meta.main) await daemonMain();
