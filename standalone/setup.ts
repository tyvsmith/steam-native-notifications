/** Native Linux setup. No Steam launcher, binary, process or runtime-selection edits. */
import { mkdir, readFile, writeFile, realpath, lstat, readdir, unlink, rm, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { CONFIG_DEFAULTS } from './host';
import { connectSteamContext } from './daemon';
import { inspectEndpoint } from './diagnostics';
import { heartbeatReady } from './health';
import { discoverSteam, setupPaths, exists, UNIT, type Paths } from './paths';
export { discoverSteam, setupPaths, UNIT } from './paths';

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
export function serviceText(paths: Paths, root: string, bun: string, steam: string): string {
    systemdQuote(root); // validate line/control characters; WorkingDirectory is a raw path directive.
    const args = [bun, join(root, 'standalone/daemon.ts'), '--config', paths.config, '--steam-dir', steam];
    return `[Unit]\nDescription=Experimental Steam RT3 native notifications\nPartOf=graphical-session.target\nAfter=graphical-session-pre.target\n\n[Service]\nType=exec\nWorkingDirectory=${root.replace(/%/g, '%%')}\nExecStart=${args.map(value => systemdQuote(value.replace(/\$/g, '$$$$'))).join(' ')}\nRestart=on-failure\nRestartSec=5\nUMask=0077\n` +
        ['HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME'].map((key, index) =>
            `Environment=${systemdQuote(`${key}=${[paths.home, paths.configHome, paths.cacheHome, paths.dataHome, paths.stateHome][index]}`)}\n`).join('') +
        `\n[Install]\nWantedBy=graphical-session.target\n`;
}
export function autostartText(paths: Paths, root: string, bun: string): string {
    return `[Desktop Entry]\nType=Application\nName=Steam native notifications (experimental)\nNoDisplay=true\nExec=${[bun, join(root, 'standalone/setup.ts'), 'session', '--state-file', paths.state].map(desktopQuote).join(' ')}\n`;
}
export type FileRecord = { path: string; owned: boolean; dev?: number; ino?: number; hash?: string };
export type InstallState = { version: 1; root: string; bun: string; steam: string; paths: Paths; files: FileRecord[] };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
async function fingerprint(path: string): Promise<Pick<FileRecord, 'dev' | 'ino' | 'hash'>> {
    const stat = await lstat(path);
    if (!stat.isFile()) throw new Error(`Not a regular file: ${path}`);
    return { dev: stat.dev, ino: stat.ino, hash: hash(await readFile(path, 'utf8')) };
}
async function unchanged(file: FileRecord): Promise<boolean> {
    try { const now = await fingerprint(file.path); return now.dev === file.dev && now.ino === file.ino && now.hash === file.hash; }
    catch { return false; }
}
export async function loadState(path: string): Promise<InstallState | undefined> {
    try {
        const state = JSON.parse(await readFile(path, 'utf8'));
        if (state.version !== 1 || !state.paths || !Array.isArray(state.files) || typeof state.root !== 'string' || typeof state.steam !== 'string' || typeof state.bun !== 'string') throw new Error('Invalid install state');
        const allowed = [state.paths.config, state.paths.unit, state.paths.autostart, join(state.steam, '.cef-enable-remote-debugging')];
        if (state.files.some((file: FileRecord) => !allowed.includes(file.path) || typeof file.owned !== 'boolean')) throw new Error('Invalid ownership record');
        return state;
    } catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error; }
}
async function save(state: InstallState) {
    await mkdir(dirname(state.paths.state), { recursive: true, mode: 0o700 });
    const temporary = `${state.paths.state}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, state.paths.state);
}
export async function requireBuild(root: string): Promise<void> {
    for (const asset of ['dist/standalone/frontend.js', 'standalone/daemon.ts', 'standalone/focus.lua', 'tools/notify-action', 'backend/game_focus.lua', 'backend/focus/wayland.lua', 'backend/focus/gamescope.lua']) {
        if (!await exists(join(root, asset))) throw new Error(`Missing runtime asset ${asset}; run bun install --frozen-lockfile && bun run build:standalone in the checkout.`);
    }
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
export async function activate(run: Runner): Promise<void> {
    await run(['daemon-reload']);
    await run(['enable', UNIT]);
    await run(['restart', UNIT]);
}
export async function importSession(run: Runner, env: NodeJS.ProcessEnv = process.env): Promise<void> {
    if (!env.XDG_RUNTIME_DIR || !env.DBUS_SESSION_BUS_ADDRESS || (!env.DISPLAY && !env.WAYLAND_DISPLAY)) throw new Error('Missing desktop session environment. Run setup/session from a terminal in your graphical session.');
    const present = SESSION_KEYS.filter(key => env[key]);
    const absent = SESSION_KEYS.filter(key => !env[key]);
    if (absent.length) await run(['unset-environment', ...absent]);
    await run(['import-environment', ...present]);
}
async function requireManagedUnit(state: InstallState): Promise<void> {
    const unit = state.files.find(file => file.path === state.paths.unit);
    if (!unit?.owned) throw new Error('Service file is unowned; refusing to manage another service.');
    if (!await exists(unit.path)) throw new Error('Managed unit is missing; rerun setup install to restore the managed unit, then retry uninstall or session activation.');
    if (!await unchanged(unit)) throw new Error('Service file changed or was replaced; refusing to manage another service. Restore the installed file before retrying.');
}
export async function activateSession(state: InstallState, run: Runner, env: NodeJS.ProcessEnv = process.env): Promise<void> {
    await requireManagedUnit(state);
    await importSession(run, env);
    await run(['restart', UNIT]);
}
export async function install(paths: Paths, root: string, bun: string, steam: string): Promise<InstallState> {
    await requireBuild(root);
    let state = await loadState(paths.state);
    if (state && (state.root !== root || state.steam !== steam || state.bun !== bun)) throw new Error('Existing setup uses another checkout, Bun or Steam root; uninstall that setup first (settings and shared marker are preserved).');
    state ??= { version: 1, root, bun, steam, paths, files: [] };
    const desired = [
        { path: join(steam, '.cef-enable-remote-debugging'), text: '', shared: true },
        { path: paths.config, text: JSON.stringify(CONFIG_DEFAULTS, null, 2) + '\n', shared: true },
        { path: paths.unit, text: serviceText(paths, root, bun, steam), shared: false },
        { path: paths.autostart, text: autostartText(paths, root, bun), shared: false },
    ];
    // Refuse collisions before enabling the shared marker or creating settings.
    for (const item of desired.filter(item => !item.shared)) {
        const record = state.files.find(file => file.path === item.path);
        if (await exists(item.path) && (!record?.owned || !await unchanged(record))) throw new Error(`Refusing to overwrite preexisting or modified service file: ${item.path}`);
    }
    await save(state);
    for (const item of desired) {
        const record = state.files.find(file => file.path === item.path);
        if (await exists(item.path)) {
            if (item.path.endsWith('.cef-enable-remote-debugging') && !(await lstat(item.path)).isFile()) throw new Error('CEF marker must be a regular file, not a symlink or directory');
            if (!record) { state.files.push({ path: item.path, owned: false }); await save(state); }
            continue; // Never rewrite preferences or claim a preexisting marker.
        }
        await mkdir(dirname(item.path), { recursive: true, mode: 0o700 });
        await writeFile(item.path, item.text, { flag: 'wx', mode: 0o600 });
        const created = { path: item.path, owned: true, ...await fingerprint(item.path) };
        if (record) Object.assign(record, created); else state.files.push(created);
        await save(state); // Interrupted installs can safely be rerun; unrecorded files stay unowned.
    }
    return state;
}
export async function uninstall(state: InstallState, run: Runner, removeMarker = false): Promise<string[]> {
    const preserved: string[] = [];
    const unit = state.files.find(file => file.path === state.paths.unit);
    if (unit?.owned) {
        await requireManagedUnit(state); // refuse missing/changed ownership before any command or file removal
        await run(['disable', '--now', UNIT]);
    }
    else if (await exists(state.paths.unit)) throw new Error('Service file changed or is unowned; refusing to stop/remove another service. Restore the installed file before uninstalling.');
    for (const file of state.files) {
        // Shared debugging may have gained another consumer. Marker removal is explicit even if owned.
        if (file.path.endsWith('.cef-enable-remote-debugging') && !removeMarker) { if (await exists(file.path)) preserved.push(file.path); continue; }
        if (file.owned && await unchanged(file)) await unlink(file.path);
        else if (await exists(file.path)) preserved.push(file.path);
    }
    await run(['daemon-reload']);
    await unlink(state.paths.state);
    return preserved;
}
async function status(paths: Paths, steamOption?: string): Promise<boolean> {
    const state = await loadState(paths.state);
    console.log(state ? `Setup: installed; runtime checkout ${state.root}` : 'Setup: not installed; run bun standalone/setup.ts install from your desktop terminal.');
    const steam = steamOption ? await discoverSteam(paths, steamOption) : state?.steam ?? await discoverSteam(paths);
    console.log(`Steam root: ${steam}\nCEF marker: ${await exists(join(steam, '.cef-enable-remote-debugging')) ? 'present' : 'missing; run setup install, then fully exit and launch Steam yourself'}`);
    const root = state?.root ?? resolve(import.meta.dir, '..');
    let ok = await exists(join(steam, '.cef-enable-remote-debugging'));
    try { await requireBuild(root); console.log('Build: available'); } catch (error: any) { console.log(error.message); ok = false; }
    for (const dependency of ['notify-send', 'gdbus', 'curl']) if (!Bun.which(dependency)) { console.log(`Missing dependency: ${dependency}; install it for native delivery.`); ok = false; }
    if (state) {
        try { console.log(`Service: ${await systemctl(['is-active', UNIT])}`); } catch (error: any) { console.log(error.message); ok = false; }
    }
    const inspection = await inspectEndpoint();
    console.log(`CEF: ${inspection.message}`);
    if (inspection.kind !== 'steam') return false;
    let client;
    try {
        const selected = await connectSteamContext(inspection.targets!, 8080); client = selected.client;
        const result = await client.call('Runtime.evaluate', { contextId: selected.contexts[0], returnByValue: true,
            expression: '({started: Boolean(globalThis.__snnStandaloneStarted), bridge: typeof globalThis.__snnHost === "function" && typeof globalThis.__snnReply === "function" && typeof globalThis.__snnConfig === "function"})' });
        const ready = result.result?.value;
        let heartbeat: any;
        try { heartbeat = JSON.parse(await readFile(join(state?.paths.cacheHome ?? paths.cacheHome, 'steam-native-notifications/standalone-status.json'), 'utf8')); } catch { /* no active daemon */ }
        const fresh = heartbeatReady(heartbeat, steam);
        if (!fresh || !ready?.started) { console.log('Daemon: not attached; check journalctl --user -u ' + UNIT + ' and the standalone log.'); return false; }
        if (!ready.bridge) { console.log('Daemon: frontend bridge incomplete; check standalone.log and client compatibility.'); return false; }
        console.log('Daemon: ready (current CDP roundtrip, frontend started, fresh live binding/backend RPC health heartbeat). This does not independently prove popup/URL registrations; check standalone.log; delivery still depends on the desktop notification server/DND.');
    } catch (error: any) { console.log(`Target: ${error.message}; wait for Steam UI initialization, check the listener or Steam update compatibility.`); return false; }
    finally { client?.close(); }
    return ok;
}
export async function otherDaemons(managedPid: number, proc = '/proc'): Promise<number[]> {
    const found: number[] = [];
    for (const name of (await readdir(proc)).filter(name => /^\d+$/.test(name))) {
        const pid = Number(name);
        if (pid === managedPid || pid === process.pid) continue;
        try {
            if ((await lstat(join(proc, String(pid)))).uid !== process.getuid!()) continue;
            const args = (await readFile(join(proc, String(pid), 'cmdline'), 'utf8')).split('\0');
            if (args.some(arg => arg === 'standalone/daemon.ts' || arg.endsWith('/standalone/daemon.ts'))) found.push(pid);
        } catch { /* exited or another user */ }
    }
    return found;
}
export async function setupMain() {
    if (process.platform !== 'linux') throw new Error('Native Linux only');
    const [command, ...args] = process.argv.slice(2);
    if (!command || command === '--help') { console.log('Usage: bun standalone/setup.ts install|status [--steam-dir DIR]\nUninstall: bun standalone/setup.ts uninstall [--remove-owned-marker] (default preserves shared debugging)\nSession: internal desktop autostart; imports current desktop environment and restarts only our daemon.\nPersistent marker uses port 8080; no Steam launchers, binaries or selection markers are edited.'); return; }
    let steamOption: string | undefined, stateFile: string | undefined, removeMarker = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--steam-dir' && ['install', 'status'].includes(command) && args[index + 1]) steamOption = args[++index];
        else if (arg === '--state-file' && command === 'session' && args[index + 1]) stateFile = args[++index];
        else if (arg === '--remove-owned-marker' && command === 'uninstall') removeMarker = true;
        else throw new Error(`Unknown/incomplete option: ${arg}`);
    }
    const paths = setupPaths();
    if (command === 'status') { if (!await status(paths, steamOption)) process.exitCode = 1; return; }
    if (!['install', 'uninstall', 'session'].includes(command)) throw new Error(`Unknown command: ${command}`);
    const statePath = stateFile ?? paths.state;
    await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
    const lock = `${statePath}.lock`;
    try { await mkdir(lock); } catch { throw new Error(`Setup already running or interrupted; if no setup process remains, remove ${lock} and retry.`); }
    try {
        if (command === 'install') {
            for (const name of ['notify-send', 'gdbus', 'curl']) if (!Bun.which(name)) throw new Error(`Missing ${name}; install native delivery dependencies before setup.`);
            await importSession(systemctl);
            const inspection = await inspectEndpoint();
            if (inspection.kind === 'conflict' || inspection.kind === 'unsafe') throw new Error(inspection.message);
            const managedPid = Number(await systemctl(['show', UNIT, '--property=MainPID', '--value']));
            const detached = await otherDaemons(managedPid);
            if (detached.length) throw new Error(`Unmanaged standalone daemon(s): ${detached.join(', ')}. Stop those daemons yourself before installing; setup will not kill them or Steam.`);
            const steam = await discoverSteam(paths, steamOption);
            await install(paths, await realpath(resolve(import.meta.dir, '..')), await realpath(process.execPath), steam);
            await activate(systemctl);
            console.log('Installed. Launch Steam normally. If CEF is missing, fully exit and launch Steam yourself when convenient; setup never restarts Steam. Run bun standalone/setup.ts status.');
        } else {
            const state = await loadState(statePath);
            if (!state) { console.log('No managed setup found; nothing changed.'); return; }
            if (command === 'session') await activateSession(state, systemctl);
            else console.log('Uninstalled. Preserved: ' + (await uninstall(state, systemctl, removeMarker)).join(', ') + '\nInjected hooks persist until Steam exits; no Steam process was changed.');
        }
    } finally { await rm(lock, { recursive: true }); }
}
if (import.meta.main) setupMain().catch(error => { console.error(error.message); process.exitCode = 1; });
