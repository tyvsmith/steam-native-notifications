import { controlCall } from './control';
import { UNIT } from './paths';
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

export const SESSION_KEYS = ['DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XDG_CURRENT_DESKTOP', 'XDG_SESSION_TYPE', 'PATH'];
export function systemdQuote(value: string): string {
    if (/[\r\n\0]/.test(value)) throw new Error('Paths/environment cannot contain control characters');
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%') + '"';
}
export function desktopQuote(value: string): string {
    if (/[\r\n\0]/.test(value)) throw new Error('Paths cannot contain control characters');
    // Desktop Entry parsing occurs before Exec quoting: backslashes require two levels.
    return '"' + value.replace(/\\/g, '\\\\\\\\').replace(/["`$]/g, '\\\\$&').replace(/%/g, '%%') + '"';
}
export type Runner = (args: string[]) => Promise<string>;
export const systemctl: Runner = async args => {
    const child = Bun.spawn(['systemctl', '--user', ...args], { stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => child.kill(), 10000);
    try {
        const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        if (code !== 0) throw new Error(`systemctl --user ${args.join(' ')} failed: ${err.trim() || out.trim()}. Run setup from your logged-in desktop session.`);
        return out.trim();
    } finally { clearTimeout(timer); }
};
export async function importSession(run: Runner, env: NodeJS.ProcessEnv = process.env): Promise<void> {
    if (!env.XDG_RUNTIME_DIR || !env.DBUS_SESSION_BUS_ADDRESS || (!env.DISPLAY && !env.WAYLAND_DISPLAY)) throw new Error('Missing desktop session environment. Run setup/session from a terminal in your graphical session.');
    const present = SESSION_KEYS.filter(key => env[key]);
    const absent = SESSION_KEYS.filter(key => !env[key]);
    if (absent.length) await run(['unset-environment', ...absent]);
    await run(['import-environment', ...present]);
}
