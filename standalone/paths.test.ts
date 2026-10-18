import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setupPaths, discoverSteam } from './paths';
import { acquireDaemonLock } from './lock';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
    const home = await mkdtemp(join(tmpdir(), 'snn-install-')); dirs.push(home);
    const paths = setupPaths({ XDG_DATA_HOME: join(home, 'data'), XDG_CONFIG_HOME: join(home, 'cfg'), XDG_STATE_HOME: join(home, 'state'), XDG_CACHE_HOME: join(home, 'cache') }, home);
    const steam = join(paths.dataHome, 'Steam');
    for (const file of ['steam.sh', 'steamrt64/steam']) { await mkdir(join(steam, file, '..'), { recursive: true }); await writeFile(join(steam, file), 'fixture'); }
    return { paths, steam };
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
test('kernel daemon lock refuses duplicates and releases without stale PID handling', async () => {
    const { paths } = await fixture();
    const release = await acquireDaemonLock(paths.home);
    try { await expect(acquireDaemonLock(paths.home)).rejects.toThrow('Another standalone'); }
    finally { await release(); }
    await (await acquireDaemonLock(paths.home))();
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
