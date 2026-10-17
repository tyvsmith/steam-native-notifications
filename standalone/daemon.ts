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

export async function attach(client: CDP, bundle: string, host: Host, alive: () => boolean = () => true, initialContexts: number[] = []): Promise<void> {
    let context: number | undefined;
    let injected = false;
    const defaults = new Set<number>(initialContexts);
    let generation = 0;
    let busy = 0;
    let disconnected = false;
    const resetControl = () => { host.frontendCommand = undefined; Object.assign(host.live, { state: 'waiting-for-context', frontendBuild: null, hook: 'unknown', control: false }); };
    void client.closed.then(() => { disconnected = true; });
    client.onEvent = message => {
        if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault) defaults.add(message.params.context.id);
        if (message.method === 'Runtime.executionContextsCleared') { generation++; context = undefined; injected = false; defaults.clear(); resetControl(); }
        if (message.method === 'Runtime.executionContextDestroyed') {
            defaults.delete(message.params.executionContextId);
            if (context === message.params.executionContextId) { generation++; context = undefined; injected = false; resetControl(); }
        }
        if (message.method !== 'Runtime.bindingCalled' || message.params.name !== '__snnHost' || message.params.executionContextId !== context || busy >= 64) return;
        void (async () => {
            busy++;
            try {
                const request = requestPayload(message.params.payload);
                let value = '', error: string | undefined;
                try { value = await host.dispatch(request.method, request.args); }
                catch (reason: any) { error = reason.message; }
                await client.call('Runtime.evaluate', { contextId: message.params.executionContextId,
                    expression: `globalThis.__snnReply?.(${request.id},${JSON.stringify(value)},${JSON.stringify(error ?? null)})` });
            } catch (error: any) { await host.log(`standalone: binding refused: ${error.message}`); }
            finally { busy--; }
        })().catch(() => {});
    };
    await client.call('Runtime.enable');
    await client.call('Runtime.addBinding', { name: '__snnHost' });
    let previousConfig = '';
    let configGeneration = 0;
    while (alive()) {
        if (!injected) {
            for (const candidate of defaults) {
                const epoch = generation;
                const probe = await client.call('Runtime.evaluate', { contextId: candidate, returnByValue: true,
                    expression: 'Boolean(globalThis.g_PopupManager && globalThis.SteamClient)' });
                if (probe.result?.value !== true || generation !== epoch || !defaults.has(candidate)) continue;
                context = candidate;
                const values = await host.settings();
                if (generation !== epoch || context !== candidate) continue;
                const result = await client.call('Runtime.evaluate', { contextId: context,
                    expression: `if (!globalThis.__snnStandaloneStarted) { globalThis.__snnInitialConfig=${JSON.stringify(values)};\n${bundle}\n} globalThis.__snnConfig(${JSON.stringify(values)});` });
                if (generation !== epoch || context !== candidate || !defaults.has(candidate)) continue;
                if (result.exceptionDetails) throw new Error(`Injection failed: ${result.exceptionDetails.text}`);
                injected = true; previousConfig = JSON.stringify(values);
                await host.log('standalone: frontend attached to SharedJSContext');
                break;
            }
        } else {
            const update = configGeneration;
            const epoch = generation;
            const values = JSON.stringify(await host.settings());
            if (update === configGeneration && epoch === generation && injected && context !== undefined && values !== previousConfig) {
                await client.call('Runtime.evaluate', { contextId: context, expression: `globalThis.__snnConfig(${values})` });
                previousConfig = values;
            }
        }
        let ready = false;
        if (injected && context !== undefined) {
            const epoch = generation;
            const probe = await client.call('Runtime.evaluate', { contextId: context, returnByValue: true, awaitPromise: true,
                expression: healthExpression(2 ** 52 + Math.floor(Math.random() * 1000000000)) });
            ready = probe.result?.value === true && injected && context !== undefined && epoch === generation;
            const info = await client.call('Runtime.evaluate', { contextId: context, returnByValue: true,
                expression: '({frontendBuild:globalThis.__snnFrontendBuild ?? null,hook:globalThis.__snnHookState ?? "unknown",panel:globalThis.__snnPanelState ?? "unavailable",control:typeof globalThis.__snnDevControl === "function"})' });
            if (epoch === generation) Object.assign(host.live, info.result?.value ?? {});
            if (epoch !== generation || context === undefined) { ready = false; continue; }
            host.frontendCommand = async (envelope, sample) => {
                if (!injected || context === undefined || epoch !== generation || envelope.deadline <= Date.now()) throw new Error('Frontend changed or request expired');
                const update = ++configGeneration;
                const values = await host.settings();
                if (update !== configGeneration || !alive() || disconnected || !injected || context === undefined || epoch !== generation || envelope.deadline <= Date.now()) throw new Error('Frontend changed or request expired');
                // A write acknowledgement can precede the periodic config push.
                // Apply the saved snapshot in the same turn as the test command.
                const reply = await client.call('Runtime.evaluate', { contextId: context, returnByValue: true, awaitPromise: true,
                    expression: `globalThis.__snnConfig(${JSON.stringify(values)}); globalThis.__snnDevControl ? globalThis.__snnDevControl(${JSON.stringify(envelope)},${sample}) : ({ok:false,error:"Older frontend lacks control support; restart Steam"})` });
                if (reply.exceptionDetails || !reply.result?.value?.ok) throw new Error(reply.result?.value?.error ?? 'Frontend execution failed');
                return reply.result.value.value;
            };

        }
        await host.readiness(ready ? 'ready' : 'waiting-for-context');
        await Bun.sleep(1000);
        if (disconnected) throw new Error('Steam CDP disconnected');
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
        for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { running = false; client?.close(); host.stop(); });
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
