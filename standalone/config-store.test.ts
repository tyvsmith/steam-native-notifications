import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile, stat, rename } from 'node:fs/promises';
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

test('directory watch pushes local writes, external atomic replacements and invalid-file recovery without idle reads', async () => {
    const { dir, path, store } = await fixture();
    const snapshots: any[] = [];
    let reads = 0;
    const read = store.read.bind(store);
    store.read = () => { reads++; return read(); };
    const stop = await store.subscribe(snapshot => snapshots.push(snapshot));
    const waitFor = async (predicate: () => boolean) => { const deadline = Date.now() + 1000; while (!predicate() && Date.now() < deadline) await Bun.sleep(2); expect(predicate()).toBe(true); };
    try {
        await store.update({ notifyInGame: false });
        expect(snapshots.at(-1).values.notifyInGame).toBe(false);
        await Bun.sleep(20); const idle = reads;
        await Bun.sleep(60); expect(reads).toBe(idle);
        const replace = async (text: string) => { const temporary = join(dir, 'replacement'); await writeFile(temporary, text); await rename(temporary, path); };
        await replace('{"notifyInGame":true}');
        await waitFor(() => snapshots.at(-1).values.notifyInGame === true);
        await replace('{broken');
        await waitFor(() => !!snapshots.at(-1).error);
        expect(snapshots.at(-1).values.notifyInGame).toBe(true);
        await replace('{"notifyInGame":false}');
        await waitFor(() => snapshots.at(-1).values.notifyInGame === false && snapshots.at(-1).error === null);
    } finally { stop(); }
    const count = snapshots.length;
    await writeFile(path, '{}'); await Bun.sleep(20); expect(snapshots).toHaveLength(count);
});

test('watch failure is visible and unsubscribe cancels recovery', async () => {
    const { store } = await fixture();
    await store.update({ notifyInGame: false });
    const snapshots: any[] = [];
    const stop = await store.subscribe(snapshot => snapshots.push(snapshot));
    (store as any).watcher.emit('error', new Error('watch fixture failure'));
    expect(snapshots.at(-1).error).toContain('watch fixture failure');
    expect((await store.read()).error).toContain('watch fixture failure');
    expect((await store.read()).values.notifyInGame).toBe(false);
    expect((store as any).watchRetry).toBeDefined();
    stop(); expect((store as any).watchRetry).toBeUndefined();
});
