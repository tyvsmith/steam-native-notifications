import { runtimeAsset } from './runtime-paths';
import { BUILD_IDENTITY, parseCallableJson, type HostKind } from '../shared/host';
import { DEFAULTS, normalizeSettings, validateSettingsPatch } from '../shared/settings';
import { validateDevCommand } from '../shared/dev-command';
import { mepCall } from '../tools/lib/mep';
import { captureReport } from '../tools/lib/cli/capture-millennium';
import { PLUGIN_ID, writeDevFire, writeCommandFile } from '../tools/lib/snn';
import { configStore, type ConfigSnapshot } from './config-store';
import { controlCall } from './control';
export type HostSelection = HostKind | 'auto';
async function millennium(method: string, params: Record<string, any> = {}): Promise<any> {
    const reply = await mepCall(method, params, { timeoutMs: 1000 }); if (reply.error !== null && reply.error !== undefined) throw new Error(String(reply.error)); return parseCallableJson(reply.result, reply.result);
}
export async function hostStatus(): Promise<any[]> {
    return Promise.all(['standalone', 'millennium'].map(async kind => {
        try {
            if (kind === 'standalone') return { ...await controlCall('status', undefined, { timeoutMs: 1200 }), present: true };
            const status = await millennium('plugin.status', { name: PLUGIN_ID });
            const running = status?.running === true || status?.backend?.running === true;
            return { host: kind, present: true, state: running ? 'ready' : 'stopped', status, frontendBuild: null, build: BUILD_IDENTITY, evidence: 'Backend status; frontend build and hook readiness unmeasured', capabilities: { settingsWrite: true, sample: running, developerCommands: running } };
        } catch (e: any) { return { host: kind, present: false, state: 'unavailable', error: e.message }; }
    }));
}
export async function selectHost(selection: HostSelection = 'auto', mutation = false): Promise<HostKind> {
    if (selection !== 'auto') { if (mutation) { const current = (await hostStatus()).find(s => s.host === selection); if (!current?.present || current.state !== 'ready') throw new Error(current?.action ?? `${selection} is not ready`); } return selection; }
    const statuses = await hostStatus(); const ready = statuses.filter(s => s.present && s.state === 'ready');
    if (ready.length === 1) return ready[0].host;
    if (ready.length > 1) throw new Error('Both hosts are ready; select --host millennium or --host standalone explicitly');
    if (!mutation) { const present = statuses.filter(s => s.present); if (present.length === 1) return present[0].host; }
    throw new Error(statuses.find(s => s.action)?.action ?? 'No ready host; start Steam with the chosen host');
}
export async function readConfig(selection: HostSelection = 'standalone'): Promise<ConfigSnapshot> {
    const host = selection === 'auto' ? await selectHost(selection) : selection;
    if (host === 'millennium') return { values: normalizeSettings(await millennium('plugin.config.get_all', { name: PLUGIN_ID })), error: null };
    try { return await controlCall('config.read'); } catch { return configStore().read(); }
}
export async function updateConfig(patch: unknown, selection: HostSelection = 'standalone'): Promise<ConfigSnapshot> {
    const values = validateSettingsPatch(patch); const host = selection === 'auto' ? await selectHost(selection, true) : selection;
    if (host === 'millennium') { for (const [key, value] of Object.entries(values)) await millennium('plugin.config.set', { name: PLUGIN_ID, key, value }); return readConfig(host); }
    // Offline edits use the same serialized, atomic store. Never retry a possibly applied socket mutation.
    const statuses = await hostStatus(); if (statuses.find(s => s.host === host)?.present) return controlCall('config.update', values);
    return configStore().update(values);
}
export function resetConfig(selection: HostSelection = 'standalone'): Promise<ConfigSnapshot> { return updateConfig(DEFAULTS, selection); }
export async function fire(command: unknown, selection: HostSelection = 'auto'): Promise<unknown> {
    const validated = validateDevCommand(command); const host = await selectHost(selection, true);
    if (host === 'standalone') return controlCall('dev.fire', validated);
    if (!(await readConfig(host)).values.devFire) throw new Error('Developer commands are disabled');
    const id = crypto.randomUUID(); writeDevFire({ id, createdAt: Date.now(), deadline: Date.now() + 7000, command: validated });
    return { host, id, stage: 'queued', message: 'Queued with expiry. Execution is unconfirmed; older frontends need a Steam restart for this envelope.' };
}
export async function sample(selection: HostSelection = 'auto'): Promise<unknown> {
    const host = await selectHost(selection, true);
    if (host === 'standalone') return controlCall('sample');
    const id = crypto.randomUUID(); writeCommandFile({ id, createdAt: Date.now(), deadline: Date.now() + 7000 }, 'sample');
    return { host, id, stage: 'queued', message: 'Fixed sample queued with expiry; execution/capture/delivery unconfirmed. Older frontends need a Steam restart.' };
}
export async function capture(count = 8, selection: HostSelection = 'auto'): Promise<unknown> {
    if (!Number.isSafeInteger(count) || count < 0 || count > 100) throw new Error('Capture count must be 0–100');
    const host = await selectHost(selection); if (host === 'standalone') return controlCall('capture', count);
    return { host, status: (await hostStatus()).find(s => s.host === host), lines: await captureReport(runtimeAsset('tools/capture'), count), evidence: 'Historical logs; hook freshness and banner visibility unmeasured' };
}
