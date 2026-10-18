import { mkdir, readFile, writeFile, lstat, rename, unlink, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setupPaths, discoverSteam, exists, UNIT, type Paths } from './paths';
import { serviceState, restoreService, waitForService, desktopQuote, systemdQuote, systemctl, importSession, type Runner, type Readiness, type ServiceState } from './service-lifecycle';
import { runtimeRoot } from './runtime-paths';
import { CONFIG_DEFAULTS } from './host';

export type Runtime = { bun: string; cli: string; buildId: string };
type State = { version: 3; steam: string; files: Record<string, string> };
type Change = { path: string; before: string | null; after: string | null };
type Transaction = { kind: 'setup' | 'teardown'; changes: Change[]; manager: ServiceState; previous: boolean };
/** Fixture-only interruption observer, never selected by CLI or environment. */
export type Checkpoint = (step: string) => Promise<void>;
const noCheckpoint: Checkpoint = async () => {};
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const transactionPath = (p: Paths) => `${p.state}.transaction`;
const targets = (p: Paths) => [p.unit, p.autostart, p.state];
async function content(path: string): Promise<string | null> {
    if (!await exists(path)) return null;
    if (!(await lstat(path)).isFile()) throw new Error(`Unsafe managed file: ${path}`);
    return readFile(path, 'utf8');
}
async function atomic(path: string, value: string | null) {
    if (value === null) { if (await exists(path)) await unlink(path); return; }
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try { await writeFile(temp, value, { flag: 'wx', mode: 0o600 }); await rename(temp, path); }
    finally { await rm(temp, { force: true }); }
}
async function load(p: Paths): Promise<State | undefined> {
    const raw = await content(p.state); if (raw === null) return undefined;
    const state = JSON.parse(raw) as State;
    if (state.version !== 3 || typeof state.steam !== 'string' || !state.steam.startsWith('/') || resolve(state.steam) !== state.steam || !state.files || Object.keys(state.files).sort().join() !== [p.unit, p.autostart].sort().join()) throw new Error('Malformed integration journal');
    for (const path of [p.unit, p.autostart]) {
        const text = await content(path);
        if (text === null || digest(text) !== state.files[path]) throw new Error(`Modified/unowned managed file: ${path}`);
    }
    return state;
}
function unit(p: Paths, runtime: Runtime, steam: string) {
    const command = [runtime.bun, runtime.cli, 'daemon', '--config', p.config, '--steam-dir', steam];
    return `[Unit]\nDescription=Steam native notifications\nPartOf=graphical-session.target\nAfter=graphical-session-pre.target\n[Service]\nType=exec\nExecStart=${command.map(x => systemdQuote(x.replace(/\$/g, '$$$$'))).join(' ')}\nRestart=on-failure\nRestartSec=5\nUMask=0077\n` +
        ['HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME'].map((key, i) => `Environment=${systemdQuote(`${key}=${[p.home, p.configHome, p.cacheHome, p.dataHome, p.stateHome][i]}`)}\n`).join('') + '[Install]\nWantedBy=graphical-session.target\n';
}
async function validateTransaction(p: Paths): Promise<Transaction | undefined> {
    const raw = await content(transactionPath(p)); if (raw === null) return undefined;
    const tx = JSON.parse(raw) as Transaction;
    if (!['setup', 'teardown'].includes(tx.kind) || typeof tx.previous !== 'boolean' || typeof tx.manager?.enabled !== 'boolean' || typeof tx.manager?.active !== 'boolean' || !Array.isArray(tx.changes) || tx.changes.length !== 3) throw new Error('Invalid integration transaction');
    for (const [i, change] of tx.changes.entries()) {
        if (change.path !== targets(p)[i] || ![change.before, change.after].every(value => value === null || typeof value === 'string') || (tx.kind === 'teardown' && change.after !== null)) throw new Error('Unsafe integration transaction');
        await assertUnchanged(change);
    }
    return tx;
}
async function assertUnchanged(change: Change) {
    const current = await content(change.path);
    if (current !== change.before && current !== change.after) throw new Error(`Modified recovery target preserved: ${change.path}`);
}
/** Setup rolls back integration only; Bun owns the package and its version. */
export async function recover(p: Paths, run: Runner = systemctl, checkpoint: Checkpoint = noCheckpoint) {
    const tx = await validateTransaction(p); if (!tx) return false;
    if (tx.kind === 'teardown' || !tx.previous) {
        // Recreate the known unit if cleanup was interrupted after removing it.
        const change = tx.changes[0]!;
        if (await content(p.unit) === null) await atomic(p.unit, change.before ?? change.after);
        await run(['disable', '--now', UNIT]); await checkpoint('recovery-stopped');
    }
    for (const change of tx.changes) {
        await assertUnchanged(change);
        await atomic(change.path, tx.kind === 'teardown' ? null : change.before);
        await checkpoint(`recovery-file:${change.path}`);
    }
    await run(['daemon-reload']); await checkpoint('recovery-reloaded');
    if (tx.kind === 'setup' && tx.previous) { await restoreService(run, tx.manager); await checkpoint('recovery-service'); }
    await unlink(transactionPath(p)); return true;
}
export async function setupIntegration(p: Paths, runtime: Runtime, steamOption?: string, run: Runner = systemctl, verify: Readiness = waitForService, checkpoint: Checkpoint = noCheckpoint) {
    if (await exists(transactionPath(p))) throw new Error('Interrupted integration setup: run snn recover');
    for (const path of [runtime.bun, runtime.cli]) if (!path.startsWith('/') || !await exists(path)) throw new Error(`Missing absolute runtime path: ${path}`);
    if (!/^[a-f0-9]{64}$/.test(runtime.buildId)) throw new Error('Invalid runtime build identity');
    const old = await load(p);
    if (!old) for (const path of [p.unit, p.autostart]) if (await exists(path)) throw new Error(`Unowned collision: ${path}`);
    const steam = await discoverSteam(p, steamOption ?? old?.steam);
    if (old && old.steam !== steam) throw new Error('Steam root change refused; teardown the existing integration first');
    const marker = join(steam, '.cef-enable-remote-debugging');
    for (const path of [p.config, marker]) await content(path);
    const manager = old ? await serviceState(run) : { enabled: false, active: false };
    const files = {
        [p.unit]: unit(p, runtime, steam),
        [p.autostart]: `[Desktop Entry]\nType=Application\nName=Steam native notifications\nNoDisplay=true\nExec=${[runtime.bun, runtime.cli, 'session'].map(desktopQuote).join(' ')}\n`,
    };
    const state: State = { version: 3, steam, files: Object.fromEntries(Object.entries(files).map(([path, value]) => [path, digest(value)])) };
    const desired: Record<string, string> = { ...files, [p.state]: JSON.stringify(state, null, 2) + '\n' };
    const tx: Transaction = { kind: 'setup', changes: await Promise.all(targets(p).map(async path => ({ path, before: await content(path), after: desired[path]! }))), manager, previous: !!old };
    await atomic(transactionPath(p), JSON.stringify(tx));
    await checkpoint('setup-journaled');
    try {
        // These shared files survive rollback and teardown; preferences are never overwritten.
        for (const [path, value] of [[p.config, JSON.stringify({ ...CONFIG_DEFAULTS, devFire: false, devMode: false }, null, 2) + '\n'], [marker, '']] as const) {
            if (!await exists(path)) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, value, { flag: 'wx', mode: 0o600 }); }
        }
        for (const change of tx.changes) { await assertUnchanged(change); await atomic(change.path, change.after); await checkpoint(`setup-file:${change.path}`); }
        await run(['daemon-reload']);
        if (!old) await run(['enable', UNIT]);
        if (!old || manager.active) { await run(['restart', UNIT]); await verify(run, runtime.buildId); }
        await checkpoint('setup-activated'); await unlink(transactionPath(p));
        return { steam, activation: !old || manager.active ? 'verified' : 'staged; service remains stopped', restartNeeded: true };
    } catch (error) {
        try { await recover(p, run); } catch (recovery: any) { throw new Error(`Integration activation failed; recovery pending: ${recovery.message}`); }
        throw error;
    }
}
export async function integrationCommand(command: string, args: string[], p = setupPaths(), run: Runner = systemctl, checkpoint: Checkpoint = noCheckpoint, fixtureRuntime?: Runtime, verify: Readiness = waitForService) {
    if (process.platform === 'win32') return (await import('./windows-installer')).windowsIntegration(command, args, p);
    let steam: string | undefined;
    for (let i = 0; i < args.length; i++) {
        if (command === 'setup' && args[i] === '--steam-dir' && args[i + 1]) steam = args[++i];
        else throw new Error(`Unknown/incomplete option: ${args[i]}`);
    }
    await mkdir(dirname(p.state), { recursive: true, mode: 0o700 });
    const lock = `${p.state}.lock`;
    try { await mkdir(lock); } catch { throw new Error(`Setup locked; after verifying no setup remains, remove ${lock}`); }
    try {
        if (command === 'recover') return { recovered: await recover(p, run, checkpoint) };
        if (command === 'teardown' && await exists(transactionPath(p))) {
            const tx = await validateTransaction(p);
            if (tx?.kind !== 'teardown') throw new Error('Setup recovery pending: run snn recover');
            await recover(p, run, checkpoint); return { removed: true, restartNeeded: true };
        }
        if (await exists(transactionPath(p))) throw new Error('Recovery pending: run snn recover');
        if (command === 'setup') {
            // Fixtures supply a runtime directly; production always checks desktop dependencies.
            let runtime = fixtureRuntime;
            if (!runtime) {
                for (const name of ['notify-send', 'gdbus', 'curl']) if (!Bun.which(name)) throw new Error(`Missing required dependency: ${name}`);
                const root = runtimeRoot();
                const build = JSON.parse(await readFile(join(root, 'dist/standalone/build.json'), 'utf8'));
                await importSession(run);
                runtime = { bun: process.execPath, cli: join(root, 'standalone/cli.js'), buildId: build.buildId };
            }
            return await setupIntegration(p, runtime, steam, run, verify, checkpoint);
        }
        const state = await load(p);
        if (!state) { if (command === 'teardown') return { removed: false }; throw new Error('No managed integration; run snn setup'); }
        if (command === 'session') {
            if (!(await serviceState(run)).enabled) return { session: 'disabled' };
            await importSession(run); await run(['restart', UNIT]); return { session: 'activated' };
        }
        if (command === 'teardown') {
            const tx: Transaction = { kind: 'teardown', changes: await Promise.all(targets(p).map(async (path): Promise<Change> => ({ path, before: await content(path), after: null }))), previous: true, manager: await serviceState(run) };
            await atomic(transactionPath(p), JSON.stringify(tx)); await checkpoint('teardown-journaled');
            await recover(p, run, checkpoint);
            return { removed: true, preserved: [p.config, join(state.steam, '.cef-enable-remote-debugging')], restartNeeded: true };
        }
        throw new Error('Unknown integration command');
    } finally { await rm(lock, { recursive: true }); }
}
