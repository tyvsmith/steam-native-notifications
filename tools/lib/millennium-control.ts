import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runtimeDir } from './snn';
import { BUILD_IDENTITY } from '../../shared/host';

/** Ignore partial writes and unrelated replies; absence never means success. */
export async function waitForReply(path: string, id: string, deadline: number): Promise<any | null> {
    while (Date.now() < deadline) {
        try { const reply = JSON.parse(await readFile(path, 'utf8')); if (reply?.id === id) return reply; } catch { /* absent or writing */ }
        await Bun.sleep(Math.min(100, Math.max(0, deadline - Date.now())));
    }
    return null;
}
/** Each caller owns its request directory, including timeout cleanup. */
export async function mailboxRequest(kind: 'status' | 'sample' | 'dev', command: unknown, timeoutMs: number, root = join(runtimeDir(), '.control-requests')): Promise<any | null> {
    const request = { id: crypto.randomUUID(), createdAt: Date.now(), deadline: Date.now() + timeoutMs, command };
    const directory = join(root, request.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
        await writeFile(join(directory, 'pending'), JSON.stringify(request), { mode: 0o600, flag: 'wx' });
        await rename(join(directory, 'pending'), join(directory, kind));
        return await waitForReply(join(directory, 'result'), request.id, request.deadline);
    } finally { await rm(directory, { recursive: true, force: true }); }
}
export async function probeMillennium(): Promise<any | null> {
    return mailboxRequest('status', undefined, 3500);
}
/** A saved config write and a confirmed live reload are separate outcomes. */
export async function refreshMillenniumSettings(): Promise<{ refreshed: boolean; message: string }> {
    try {
        const reply = await mailboxRequest('status', 'refresh-settings', 3500);
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
    const reply = await mailboxRequest(sample ? 'sample' : 'dev', command, 7000);
    if (!reply) return { host: 'millennium', stage: 'queued', message: 'No execution acknowledgement before expiry; execution, capture and delivery are unconfirmed' };
    if (reply.result?.ok !== true) throw new Error(reply.result?.error ?? 'Frontend execution failed');
    const value = reply.result.value;
    if (value?.id !== reply.id || value?.stage !== 'executed') throw new Error('Invalid frontend execution acknowledgement');
    return { host: 'millennium', ...value };
}
