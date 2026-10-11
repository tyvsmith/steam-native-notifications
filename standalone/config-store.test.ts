import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigStore } from './config-store';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() { const dir = await mkdtemp(join(tmpdir(), 'snn-config-')); dirs.push(dir); const path = join(dir, 'settings.json'); return { dir, path, store: new ConfigStore(path) }; }
test('strict known boolean writes preserve unknown and other-platform settings, reset preserves unknown', async () => {
    const { path, store } = await fixture(); await writeFile(path, JSON.stringify({ unknown: { keep: 1 }, notificationCenterOnlyInGame: true }));
    await store.update({ notifyOutsideGame: false });
    expect((await store.read()).values.notificationCenterOnlyInGame).toBe(true);
    expect(JSON.parse(await readFile(path, 'utf8')).unknown).toEqual({ keep: 1 });
    expect(() => store.update({ devFire: 'true' })).toThrow(); expect(() => store.update({ alien: true })).toThrow();
    await store.reset(); expect(JSON.parse(await readFile(path, 'utf8')).unknown).toEqual({ keep: 1 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
});
test('invalid external edits retain last good, report and refuse overwrite', async () => {
    const { path, store } = await fixture(); await store.update({ notifyInGame: false }); await writeFile(path, '{bad');
    const snapshot = await store.read(); expect(snapshot.values.notifyInGame).toBe(false); expect(snapshot.error).toContain('Invalid');
    await expect(store.update({ devFire: true })).rejects.toThrow('repair');
    await writeFile(path, '{"devFire":"true"}'); expect((await store.read()).error).toContain('Invalid boolean');
});
test('independent stores and processes serialize updates without lost keys', async () => {
    const { path, store } = await fixture();
    await Promise.all([store.update({ notifyInGame: false }), new ConfigStore(path).update({ showSteamOutsideGame: true })]);
    const module = join(import.meta.dir, 'config-store.ts');
    const children = ['devFire', 'devMode'].map(key => Bun.spawn([process.execPath, '-e', `import { ConfigStore } from ${JSON.stringify(module)}; await new ConfigStore(${JSON.stringify(path)}).update({${key}:true});`], { stdout: 'pipe', stderr: 'pipe' }));
    for (const child of children) expect(await child.exited).toBe(0);
    expect((await store.read()).values).toMatchObject({ notifyInGame: false, showSteamOutsideGame: true, devFire: true, devMode: true });
});
