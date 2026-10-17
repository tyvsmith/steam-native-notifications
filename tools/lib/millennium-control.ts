import { watch } from 'node:fs';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PLUGIN_ID, runtimeDir } from './snn';
import { mepCall, type MepCallOptions } from './mep';
import { BUILD_IDENTITY } from '../../shared/host';

/** Correlated request-scoped watcher; no idle work. */
export async function pushRequest(kind: 'status' | 'sample' | 'dev', command: unknown, timeoutMs: number,
    root = join(runtimeDir(), '.control-requests'), options: MepCallOptions = {}): Promise<any | null> {
    const request = { id: crypto.randomUUID(), createdAt: Date.now(), deadline: Date.now() + timeoutMs, kind, ...(command === undefined ? {} : { command }) };
    const directory = join(root, request.id);
    const key = 'snnControl';
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let watcher: ReturnType<typeof watch> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = new Promise<any | null>((resolve) => {
            let reading = false, dirty = false;
            const read = async () => {
                if (reading) { dirty = true; return; }
                reading = true;
                do {
                    dirty = false;
                    try {
                        const reply = JSON.parse(await readFile(join(directory, 'result'), 'utf8'));
                        if (Date.now() < request.deadline && reply?.id === request.id) resolve(reply);
                    } catch { /* Wait for the next write event after partial or unrelated data. */ }
                } while (dirty);
                reading = false;
            };
            watcher = watch(directory, () => { void read(); });
            watcher.on('error', () => resolve(null));
            timer = setTimeout(() => resolve(null), timeoutMs);
        });
        const pushed = await mepCall('plugin.config.set', { name: PLUGIN_ID, key, value: JSON.stringify(request) }, { ...options, timeoutMs });
        if (pushed.error !== null && pushed.error !== undefined) return null;
        return await result;
    } catch { return null; }
    finally {
        if (timer) clearTimeout(timer);
        watcher?.close();
        await rm(directory, { recursive: true, force: true });
        try { await mepCall('plugin.config.delete', { name: PLUGIN_ID, key }, { ...options, timeoutMs: 1000 }); } catch { /* Persisted requests never replay on load. */ }
    }
}
export async function probeMillennium(): Promise<any | null> {
    return pushRequest('status', undefined, 3500);
}
/** A saved config write and a confirmed live reload are separate outcomes. */
export async function refreshMillenniumSettings(): Promise<{ refreshed: boolean; message: string }> {
    try {
        const reply = await pushRequest('status', 'refresh-settings', 3500);
        if (reply?.settingsRefreshed === true) return { refreshed: true, message: 'Running settings refreshed' };
    } catch { /* The config is already saved; do not imply the write failed. */ }
    return { refreshed: false, message: 'Settings saved; live reload unconfirmed. Reopen plugin settings or restart Steam.' };
}
export function millenniumReadiness(reply: any): { state: string; frontendBuild: any; hook: string; control: boolean; action: string | null; capabilities: { settingsWrite: boolean; sample: boolean; developerCommands: boolean } } {
    const compatible = reply?.frontendBuild?.buildId === BUILD_IDENTITY.buildId && reply?.frontendBuild?.protocolVersion === BUILD_IDENTITY.protocolVersion;
    const ready = compatible && reply?.hook === 'installed' && reply?.control === true;
    return { state: ready ? 'ready' : reply ? 'degraded' : 'backend-running', frontendBuild: reply?.frontendBuild ?? null,
        hook: reply?.hook ?? 'unknown', control: reply?.control === true,
        action: ready ? null : 'Frontend readiness unconfirmed or incompatible; load the matching plugin and inspect capture diagnostics',
        capabilities: { settingsWrite: true, sample: ready, developerCommands: ready } };
}
export async function millenniumCommand(command: unknown, sample: boolean): Promise<unknown> {
    const reply = await pushRequest(sample ? 'sample' : 'dev', command, 7000);
    if (!reply) return { host: 'millennium', stage: 'unconfirmed', message: 'No execution acknowledgement before expiry; execution, capture and delivery are unconfirmed' };
    if (reply.result?.ok !== true) throw new Error(reply.result?.error ?? 'Frontend execution failed');
    const value = reply.result.value;
    if (value?.id !== reply.id || value?.stage !== 'executed') throw new Error('Invalid frontend execution acknowledgement');
    return { host: 'millennium', ...value };
}
