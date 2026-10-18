import { probeMillennium, millenniumReadiness, millenniumCommand, refreshMillenniumSettings } from './millennium-control';
import { runtimeAsset } from '../../standalone/runtime-paths';
import { BUILD_IDENTITY, parseCallableJson, type BuildIdentity, type HostKind } from '../../shared/host';
import { preferenceDefaults } from '../../shared/settings-policy';
import { normalizeSettings, validateSettingsPatch } from '../../shared/settings';
import { validateDevCommand } from '../../shared/dev-command';
import { mepCall } from './mep';
import { captureReport } from './cli/capture-millennium';
import { PLUGIN_ID } from './snn';
import { configStore, type ConfigSnapshot } from '../../standalone/config-store';
import { controlCall } from '../../standalone/control';
export type HostSelection = HostKind | 'auto';
async function millennium(method: string, params: Record<string, any> = {}): Promise<any> {
    const reply = await mepCall(method, params, { timeoutMs: 1000 }); if (reply.error !== null && reply.error !== undefined) throw new Error(String(reply.error)); return parseCallableJson(reply.result, reply.result);
}
export interface HostStatus {
    host: HostKind; present: boolean | null; state: string;
    build?: BuildIdentity; frontendBuild?: BuildIdentity | null;
    capabilities?: { settingsWrite: boolean; sample: boolean; developerCommands: boolean };
    evidence?: string; action?: string; error?: string; config?: ConfigSnapshot;
    pid?: number; installedBuild?: BuildIdentity | null; hook?: string; control?: boolean; dependencies?: ReturnType<typeof import('../../standalone/dependencies').dependencies>;
}
export async function hostStatus(): Promise<HostStatus[]> {
    return Promise.all((['standalone', 'millennium'] as const).map(async kind => {
        try {
            // Status includes a renderer challenge and state readback, not just a socket ping.
            if (kind === 'standalone') return { ...await controlCall('status', undefined, { timeoutMs: 5000 }), present: true };
            const status = await millennium('plugin.status', { name: PLUGIN_ID });
            const running = status?.running === true || status?.backend?.running === true;
            const measured = running ? millenniumReadiness(await probeMillennium()) : { state: 'stopped', frontendBuild: null as BuildIdentity | null, capabilities: { settingsWrite: true, sample: false, developerCommands: false } };
            return { host: kind, present: true, status, build: BUILD_IDENTITY, ...measured, evidence: 'Correlated frontend reply measures build, hook and control; capture and banner visibility are unmeasured' };
        } catch (e: any) {
            const absent = e.code === 'ENOENT' || e.code === 'ECONNREFUSED';
            return { host: kind, present: absent ? false : null, state: absent ? 'unavailable' : 'unknown', error: e.message };
        }
    }));
}
export function operationEligible(status: HostStatus, operation: 'sample' | 'developerCommands'): boolean {
    return status.present === true && status.capabilities?.[operation] === true && ['ready', 'backend-running'].includes(status.state);
}
export async function selectHost(selection: HostSelection = 'auto', mutation = false, operation: 'sample' | 'developerCommands' = 'developerCommands'): Promise<HostKind> {
    if (selection !== 'auto') { if (mutation) { const current = (await hostStatus()).find(s => s.host === selection); if (!current?.present || !operationEligible(current, operation)) throw new Error(current?.action ?? `${selection} is not ready`); } return selection; }
    const statuses = await hostStatus();
    assertConclusiveHosts(statuses);
    const ready = statuses.filter(s => s.present && operationEligible(s, operation));
    if (ready.length === 1) return ready[0].host;
    if (ready.length > 1) throw new Error('Both hosts are ready; select --host millennium or --host standalone explicitly');
    if (!mutation) { const present = statuses.filter(s => s.present); if (present.length === 1) return present[0].host; }
    throw new Error(statuses.find(s => s.action)?.action ?? 'No ready host; start Steam with the chosen host');
}
function assertConclusiveHosts(statuses: HostStatus[]): void {
    const unknown = statuses.find(status => status.present === null);
    if (unknown) throw new Error(`${unknown.host} status is inconclusive: ${unknown.error ?? unknown.state}; select --host explicitly`);
}
/** Configuration remains available when capture is degraded or developer commands are off. */
export function selectConfigHost(statuses: HostStatus[]): HostKind {
    assertConclusiveHosts(statuses);
    const present = statuses.filter(status => status.present);
    if (present.length === 1) return present[0]!.host;
    if (present.length > 1) throw new Error('Both hosts are present; select --host millennium or --host standalone explicitly');
    throw new Error('No host available; use --host standalone or --config FILE for offline recovery');
}
/** Probe without mutating; only an absent daemon permits the default offline store. */
async function standaloneConfig() {
    let snapshot: ConfigSnapshot;
    try { snapshot = await controlCall('config.read'); }
    catch (error: any) {
        if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') return configStore();
        throw error;
    }
    return { read: async () => snapshot, update: (patch: unknown) => controlCall('config.update', patch) };
}
export async function readConfig(selection: HostSelection = 'standalone'): Promise<ConfigSnapshot> {
    const host = selection === 'auto' ? selectConfigHost(await hostStatus()) : selection;
    if (host === 'millennium') return { values: normalizeSettings((await millennium('plugin.config.get_all', { name: PLUGIN_ID })).config), error: null };
    return (await standaloneConfig()).read();
}
export async function updateConfig(patch: unknown, selection: HostSelection = 'standalone'): Promise<ConfigSnapshot & { runtime?: Awaited<ReturnType<typeof refreshMillenniumSettings>> }> {
    const values = validateSettingsPatch(patch); const host = selection === 'auto' ? selectConfigHost(await hostStatus()) : selection;
    if (host === 'millennium') {
        try {
            for (const [key, value] of Object.entries(values)) await millennium('plugin.config.set', { name: PLUGIN_ID, key, value });
        } catch (error) {
            const runtime = await refreshMillenniumSettings();
            throw new Error(`Settings write interrupted; some values may have been saved. Live reload ${runtime.refreshed ? 'confirmed' : 'unconfirmed'}. ${String(error)}`);
        }
        let snapshot: ConfigSnapshot;
        try { snapshot = await readConfig(host); }
        catch (error) {
            const runtime = await refreshMillenniumSettings();
            throw new Error(`Settings saved, but readback failed. Live reload ${runtime.refreshed ? 'confirmed' : 'unconfirmed'}. ${String(error)}`);
        }
        const runtime = await refreshMillenniumSettings();
        return { ...snapshot, runtime };
    }
    // Offline edits use the same serialized, atomic store. Never retry a possibly applied socket mutation.
    return (await standaloneConfig()).update(values);
}
export function resetConfig(selection: HostSelection = 'standalone'): Promise<ConfigSnapshot> { return updateConfig(preferenceDefaults(process.platform === 'win32' ? 'windows' : process.platform === 'linux' ? 'linux' : 'unknown'), selection); }
export async function fire(command: unknown, selection: HostSelection = 'auto'): Promise<unknown> {
    const validated = validateDevCommand(command); const host = await selectHost(selection, true);
    if (host === 'standalone') return controlCall('dev.fire', validated);
    if (!(await readConfig(host)).values.devFire) throw new Error('Developer commands are disabled');
    return millenniumCommand(validated, false);
}
export async function sample(selection: HostSelection = 'auto'): Promise<unknown> {
    const host = await selectHost(selection, true, 'sample');
    if (host === 'standalone') return controlCall('sample');
    return millenniumCommand(undefined, true);
}
export async function capture(count = 8, selection: HostSelection = 'auto'): Promise<unknown> {
    if (!Number.isSafeInteger(count) || count < 0 || count > 100) throw new Error('Capture count must be 0–100');
    const host = await selectHost(selection); if (host === 'standalone') return controlCall('capture', count);
    return { host, status: (await hostStatus()).find(s => s.host === host), lines: await captureReport(runtimeAsset('tools/capture'), count), evidence: 'Historical logs; hook freshness and banner visibility unmeasured' };
}
