import { controlCall } from './control';
import { UNIT } from './paths';
import type { Runner } from './setup';
export interface ServiceState { enabled: boolean; active: boolean }
export async function serviceState(run: Runner): Promise<ServiceState> {
    const raw = await run(['show', UNIT, '--property=UnitFileState,ActiveState']);
    const fields = Object.fromEntries(raw.split('\n').map(line => line.split('=')));
    if (!['enabled', 'disabled'].includes(fields.UnitFileState ?? '') || !['active', 'inactive', 'failed'].includes(fields.ActiveState ?? '')) throw new Error('Service state is transitional or unmanaged; retry after the service settles');
    return { enabled: fields.UnitFileState === 'enabled', active: fields.ActiveState === 'active' };
}
export async function restoreService(run: Runner, state: ServiceState): Promise<void> {
    await run([state.enabled ? 'enable' : 'disable', UNIT]);
    await run([state.active ? 'restart' : 'stop', UNIT]);
}
export type Readiness = (run: Runner, buildId: string) => Promise<void>;
/** Readiness means this service owns a responsive control socket, even while Steam is stopped. */
export async function waitForService(run: Runner, buildId: string, probe = () => controlCall('status', undefined, { timeoutMs: 500 }), timeoutMs = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs; let reason = 'control socket unavailable';
    do {
        const raw = await run(['show', UNIT, '--property=MainPID,ActiveState,SubState']);
        const fields = Object.fromEntries(raw.split('\n').map(line => line.split('=')));
        if (['failed', 'inactive'].includes(fields.ActiveState ?? '') || fields.SubState === 'auto-restart') throw new Error('Daemon exited before readiness');
        const pid = Number(fields.MainPID);
        try {
            const status = await probe();
            if (Number.isSafeInteger(pid) && pid > 0 && status.pid === pid && status.build?.buildId === buildId && status.build?.protocolVersion === 1) return;
            reason = 'control socket PID or build identity does not match the service';
        } catch (error) { reason = String(error); }
        await Bun.sleep(Math.min(200, Math.max(0, deadline - Date.now())));
    } while (Date.now() < deadline);
    throw new Error(`Daemon readiness timed out: ${reason}`);
}
