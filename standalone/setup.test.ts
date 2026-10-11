import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, lstat, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CONFIG_DEFAULTS } from './host';
import { setupPaths, discoverSteam, install, loadState, uninstall, importSession, serviceText, systemdQuote, autostartText, activate, activateSession, otherDaemons } from './setup';
import { acquireDaemonLock } from './lock';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
    const home = await mkdtemp(join(tmpdir(), 'snn-install-')); dirs.push(home);
    const paths = setupPaths({ XDG_DATA_HOME: join(home, 'data'), XDG_CONFIG_HOME: join(home, 'cfg'), XDG_STATE_HOME: join(home, 'state'), XDG_CACHE_HOME: join(home, 'cache') }, home);
    const steam = join(paths.dataHome, 'Steam'); const root = join(home, 'checkout');
    for (const file of ['steam.sh', 'steamrt64/steam']) { await mkdir(join(steam, file, '..'), { recursive: true }); await writeFile(join(steam, file), 'fixture'); }
    for (const file of ['dist/standalone/frontend.js', 'standalone/daemon.ts', 'standalone/focus.lua', 'tools/notify-action', 'backend/game_focus.lua', 'backend/focus/wayland.lua', 'backend/focus/gamescope.lua']) {
        await mkdir(join(root, file, '..'), { recursive: true }); await writeFile(join(root, file), 'fixture');
    }
    return { paths, steam, root, marker: join(steam, '.cef-enable-remote-debugging') };
}
test('XDG absolute roots; relative/empty values fall back', () => {
    expect(setupPaths({ XDG_CONFIG_HOME: 'relative', XDG_CACHE_HOME: '' }, '/home/test').configHome).toBe('/home/test/.config');
    expect(setupPaths({ XDG_STATE_HOME: '/state' }, '/home/test').state).toBe('/state/steam-native-notifications/standalone-install.json');
});
test('discovery deduplicates symlinks, supports XDG and explicit root, rejects ambiguity and Flatpak', async () => {
    const { paths, steam } = await fixture();
    await mkdir(join(paths.home, '.steam')); await symlink(steam, join(paths.home, '.steam/steam'));
    expect(await discoverSteam(paths)).toBe(steam);
    const second = join(paths.home, 'other'); await mkdir(join(second, 'ubuntu12_32'), { recursive: true });
    await writeFile(join(second, 'steam.sh'), ''); await writeFile(join(second, 'ubuntu12_32/steam'), '');
    expect(await discoverSteam(paths, second)).toBe(second);
    await symlink(second, join(paths.home, '.steam/root'));
    await expect(discoverSteam(paths)).rejects.toThrow('Multiple');
    await expect(discoverSteam(paths, '/missing')).rejects.toThrow('not found');
    await expect(discoverSteam(paths, join(paths.home, '.var/app/com.valvesoftware.Steam/data/Steam'))).rejects.toThrow();
});
test('install is idempotent with ownership retained; uninstall removes only unchanged owned settings/service', async () => {
    const { paths, steam, root, marker } = await fixture();
    const first = await install(paths, root, process.execPath, steam);
    const inode = (await lstat(marker)).ino;
    const second = await install(paths, root, process.execPath, steam);
    expect(second).toEqual(first); expect((await lstat(marker)).ino).toBe(inode);
    expect(JSON.parse(await readFile(paths.config, 'utf8'))).toEqual(CONFIG_DEFAULTS);
    expect(CONFIG_DEFAULTS.showSteamOutsideGame).toBe(false); expect(CONFIG_DEFAULTS.showSteamInGame).toBe(true);
    expect(CONFIG_DEFAULTS.devFire).toBe(false); expect(CONFIG_DEFAULTS.devMode).toBe(false);
    const commands: string[][] = [];
    expect(await uninstall(second, async args => { commands.push(args); return ''; })).toEqual([marker]);
    expect(await Bun.file(marker).exists()).toBe(true); expect(await Bun.file(paths.unit).exists()).toBe(false);
    expect(await Bun.file(paths.config).exists()).toBe(false); expect(await loadState(paths.state)).toBeUndefined();
    expect(commands[0]).toEqual(['disable', '--now', 'steam-native-notifications-standalone.service']);
});
test('preexisting marker and config are preserved byte-for-byte even with explicit marker removal', async () => {
    const { paths, steam, root, marker } = await fixture();
    await writeFile(marker, 'shared marker'); await mkdir(join(paths.config, '..'), { recursive: true });
    const preferences = '{"devFire":true,"showSteamOutsideGame":false,"custom":"keep"}\n';
    await writeFile(paths.config, preferences);
    await install(paths, root, process.execPath, steam);
    const state = await install(paths, root, process.execPath, steam);
    expect(state.files.find(file => file.path === marker)?.owned).toBe(false);
    expect(state.files.find(file => file.path === paths.config)?.owned).toBe(false);
    await uninstall(state, async () => '', true);
    expect(await readFile(marker, 'utf8')).toBe('shared marker'); expect(await readFile(paths.config, 'utf8')).toBe(preferences);
});
test('explicit removal of unchanged owned marker, while modified config/replaced marker are preserved', async () => {
    const { paths, steam, root, marker } = await fixture();
    const state = await install(paths, root, process.execPath, steam);
    await writeFile(paths.config, '{"devFire":true}');
    expect(await uninstall(state, async () => '', true)).toEqual([paths.config]);
    expect(await Bun.file(marker).exists()).toBe(false);
    const again = await install(paths, root, process.execPath, steam);
    await rm(marker); await writeFile(marker, 'now shared');
    await uninstall(again, async () => '', true);
    expect(await readFile(marker, 'utf8')).toBe('now shared');
});
test('missing build and preexisting/changed units fail before modifying shared files', async () => {
    const { paths, steam, root, marker } = await fixture();
    await rm(join(root, 'dist/standalone/frontend.js'));
    await expect(install(paths, root, process.execPath, steam)).rejects.toThrow('Missing runtime asset');
    expect(await Bun.file(marker).exists()).toBe(false);
    await writeFile(join(root, 'dist/standalone/frontend.js'), 'fixture');
    await mkdir(join(paths.unit, '..'), { recursive: true }); await writeFile(paths.unit, 'another service');
    await expect(install(paths, root, process.execPath, steam)).rejects.toThrow('Refusing');
    expect(await Bun.file(marker).exists()).toBe(false);
    await rm(paths.unit); const state = await install(paths, root, process.execPath, steam);
    await writeFile(paths.unit, 'edited'); const commands: string[][] = [];
    await expect(uninstall(state, async args => { commands.push(args); return ''; })).rejects.toThrow('changed');
    expect(commands).toEqual([]); expect(await readFile(paths.unit, 'utf8')).toBe('edited');
});
test('rerun recovers deleted owned marker; rejects runtime relocation and symlink marker', async () => {
    const { paths, steam, root, marker } = await fixture();
    await writeFile(join(root, 'target'), ''); await symlink(join(root, 'target'), marker);
    await expect(install(paths, root, process.execPath, steam)).rejects.toThrow('regular file');
    await rm(marker); await install(paths, root, process.execPath, steam); await rm(marker);
    const state = await install(paths, root, process.execPath, steam);
    expect(state.files.find(file => file.path === marker)?.owned).toBe(true);
    await expect(install(paths, root, '/different-bun', steam)).rejects.toThrow('another checkout');
});
test('service/autostart use absolute build paths, dynamic session environment, and escaped argv', async () => {
    const { paths, steam, root } = await fixture();
    const unit = serviceText(paths, root + ' space', '/opt/bun', steam);
    expect(unit).toContain(`WorkingDirectory=${root} space\n`);
    expect(unit).toContain('WantedBy=graphical-session.target'); expect(unit).toContain('PartOf=graphical-session.target');
    expect(unit).toContain('standalone/daemon.ts" "--config"'); expect(unit).not.toContain('WAYLAND_DISPLAY=');
    expect(unit).not.toContain('STEAM_FORCE_CLIENT'); expect(unit).not.toContain('-cef');
    expect(serviceText(paths, root + '$cash%foo', '/opt/bun', steam)).toContain('$$cash%%foo');
    expect(systemdQuote('a"b%')).toBe('"a\\"b%%"'); expect(() => systemdQuote('bad\npath')).toThrow();
    expect(autostartText(paths, root, '/opt/bun')).toContain('"session" "--state-file"');
    const commands: string[][] = [];
    await importSession(async args => { commands.push(args); return ''; }, { WAYLAND_DISPLAY: 'chosen-by-session', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/session/bus', XDG_RUNTIME_DIR: '/session' });
    expect(commands[0]).toContain('DISPLAY'); expect(commands[1]).toEqual(['import-environment', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR']);
    await expect(importSession(async () => '', {})).rejects.toThrow('desktop session');
});
test('kernel daemon lock refuses duplicates and releases without stale PID handling', async () => {
    const { paths } = await fixture();
    const release = await acquireDaemonLock(paths.home);
    try { await expect(acquireDaemonLock(paths.home)).rejects.toThrow('Another standalone'); }
    finally { await release(); }
    await (await acquireDaemonLock(paths.home))();
});

test('failed activation retains the ownership journal and can be retried without claiming shared files', async () => {
    const { paths, steam, root, marker } = await fixture();
    await writeFile(marker, 'shared');
    const state = await install(paths, root, process.execPath, steam);
    const commands: string[][] = [];
    await expect(activate(async args => {
        commands.push(args);
        if (args[0] === 'restart') throw new Error('fixture activation failure');
        return '';
    })).rejects.toThrow('activation failure');
    expect(await loadState(paths.state)).toEqual(state);
    const retry = await install(paths, root, process.execPath, steam);
    expect(retry).toEqual(state); expect(await readFile(marker, 'utf8')).toBe('shared');
    await activate(async args => { commands.push(args); return ''; });
    expect(commands.filter(args => args[0] === 'restart').length).toBe(2);
});
test('failed service stop preserves files/journal for a safe uninstall retry', async () => {
    const { paths, steam, root, marker } = await fixture();
    const state = await install(paths, root, process.execPath, steam);
    await expect(uninstall(state, async () => { throw new Error('cannot stop service'); }, true)).rejects.toThrow('cannot stop');
    expect(await loadState(paths.state)).toEqual(state); expect(await Bun.file(marker).exists()).toBe(true);
    expect(await Bun.file(paths.unit).exists()).toBe(true);
    await uninstall(state, async () => '', true);
    expect(await Bun.file(marker).exists()).toBe(false);
});
test('unmanaged daemon detection distinguishes an explicitly managed process and unrelated commands', async () => {
    const { paths } = await fixture(); const proc = join(paths.home, 'proc');
    for (const [pid, command] of [[76543, 'bun\0standalone/daemon.ts\0'], [76544, 'bun\0/checkout/standalone/daemon.ts\0'], [76545, 'bun\0standalone/setup.ts\0']] as const) {
        await mkdir(join(proc, String(pid)), { recursive: true });
        await writeFile(join(proc, String(pid), 'cmdline'), command);
    }
    expect((await otherDaemons(0, proc)).sort((a, b) => a - b)).toEqual([76543, 76544]);
    expect(await otherDaemons(76544, proc)).toEqual([76543]);
});
test('kernel lock automatically releases after an isolated daemon process exits', async () => {
    const { paths } = await fixture();
    const program = `import { acquireDaemonLock } from ${JSON.stringify(join(import.meta.dir, 'lock.ts'))}; await acquireDaemonLock(${JSON.stringify(paths.home)}); console.log('locked'); await Bun.sleep(10000);`;
    const child = Bun.spawn([process.execPath, '-e', program], { stdout: 'pipe', stderr: 'pipe' });
    try {
        const reader = child.stdout.getReader();
        const output = await reader.read(); expect(new TextDecoder().decode(output.value)).toContain('locked');
        await expect(acquireDaemonLock(paths.home)).rejects.toThrow('Another standalone');
    } finally { child.kill(); await child.exited; }
    await (await acquireDaemonLock(paths.home))();
});

test('missing owned unit refuses uninstall before commands/removal and reinstall restores safe recovery', async () => {
    const { paths, steam, root, marker } = await fixture();
    const state = await install(paths, root, process.execPath, steam);
    const retained = [paths.state, paths.config, paths.autostart, marker];
    const before = await Promise.all(retained.map(path => readFile(path, 'utf8')));
    await rm(paths.unit);
    const commands: string[][] = [];
    const run = async (args: string[]) => { commands.push(args); return ''; };
    await expect(uninstall(state, run, true)).rejects.toThrow('rerun setup install to restore the managed unit, then retry uninstall');
    expect(commands).toEqual([]);
    expect(await Promise.all(retained.map(path => readFile(path, 'utf8')))).toEqual(before);
    const restored = await install(paths, root, process.execPath, steam);
    expect(await Bun.file(paths.unit).exists()).toBe(true);
    await uninstall(restored, run, true);
    expect(commands[0]).toEqual(['disable', '--now', 'steam-native-notifications-standalone.service']);
});
test('session activation refuses missing, modified, replaced and unowned units before environment import/restart', async () => {
    const env = { WAYLAND_DISPLAY: 'session-display', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/session/bus', XDG_RUNTIME_DIR: '/session' };
    for (const alteration of ['missing', 'modified', 'replaced', 'unowned']) {
        const { paths, steam, root, marker } = await fixture();
        const state = await install(paths, root, process.execPath, steam);
        const retained = [paths.state, paths.config, paths.autostart, marker];
        const before = await Promise.all(retained.map(path => readFile(path, 'utf8')));
        if (alteration === 'missing') await rm(paths.unit);
        else if (alteration === 'modified') await writeFile(paths.unit, 'changed service');
        else if (alteration === 'replaced') {
            const replacement = join(paths.home, 'replacement-unit');
            await writeFile(replacement, await readFile(paths.unit, 'utf8'));
            await rename(replacement, paths.unit);
        } else state.files.find(file => file.path === paths.unit)!.owned = false;
        const commands: string[][] = [];
        await expect(activateSession(state, async args => { commands.push(args); return ''; }, env)).rejects.toThrow();
        expect(commands).toEqual([]);
        expect(await Promise.all(retained.map(path => readFile(path, 'utf8')))).toEqual(before);
    }
});
test('intact owned unit permits session environment import followed by daemon restart', async () => {
    const { paths, steam, root } = await fixture();
    const state = await install(paths, root, process.execPath, steam);
    const commands: string[][] = [];
    await activateSession(state, async args => { commands.push(args); return ''; }, {
        WAYLAND_DISPLAY: 'session-display', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/session/bus', XDG_RUNTIME_DIR: '/session',
    });
    expect(commands.map(args => args[0])).toEqual(['unset-environment', 'import-environment', 'restart']);
    expect(commands[2]).toEqual(['restart', 'steam-native-notifications-standalone.service']);
});
