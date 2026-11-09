import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MARKER } from './marker';
import { FAST_MS, FAST_WINDOW_MS, IDLE_MS, Pacer, watchSteam } from './steam-watch';

test('pacer idles only when launch events exist and no fast window is open', () => {
    let now = 0, events = true;
    const pacer = new Pacer(() => events, () => now);
    expect(pacer.delay()).toBe(FAST_MS);
    now = FAST_WINDOW_MS; expect(pacer.delay()).toBe(IDLE_MS);
    pacer.hurry(); expect(pacer.delay()).toBe(FAST_MS);
    now += FAST_WINDOW_MS; expect(pacer.delay()).toBe(IDLE_MS);
    events = false; expect(pacer.delay()).toBe(FAST_MS);
});

test('hurry ends a pending idle wait at once', async () => {
    const pacer = new Pacer(() => true, () => 1e12);
    const started = Date.now();
    const waiting = pacer.wait();
    pacer.hurry(); await waiting;
    expect(Date.now() - started).toBeLessThan(500);
});

async function until(check: () => boolean) {
    for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(20);
    return check();
}

test('reports marker deletion and Steam launches through inotify', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snn-watch-'));
    const steam = join(root, 'Steam'), home = join(root, 'home');
    await mkdir(steam); await mkdir(join(home, '.steam'), { recursive: true });
    await writeFile(join(steam, MARKER), '');
    let launches = 0, markers = 0;
    const watched = watchSteam({ steam, home, platform: 'linux', onLaunch: () => launches++, onMarker: () => markers++, log: () => {} });
    try {
        expect(watched.launchEvents()).toBe(true);
        await writeFile(join(steam, 'unrelated'), '');
        await unlink(join(steam, MARKER));
        expect(await until(() => markers > 0)).toBe(true);
        await writeFile(join(home, '.steam/steam.pid'), '1234\n');
        expect(await until(() => launches > 0)).toBe(true);
    } finally { watched.close(); await rm(root, { recursive: true, force: true }); }
});

test('without ~/.steam or off Linux the poll stays in charge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snn-watch-'));
    const logs: string[] = [];
    try {
        const missing = watchSteam({ steam: root, home: join(root, 'nohome'), platform: 'linux', onLaunch: () => {}, onMarker: () => {}, log: line => logs.push(line) });
        expect(missing.launchEvents()).toBe(false); missing.close();
        expect(logs.some(line => line.startsWith('standalone: watch:'))).toBe(true);
        await mkdir(join(root, '.steam'));
        const windows = watchSteam({ steam: root, home: root, platform: 'win32', onLaunch: () => {}, onMarker: () => {}, log: () => {} });
        expect(windows.launchEvents()).toBe(false); windows.close();
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('a failed launch watcher drops to the fast poll and wakes the pacer', () => {
    const { EventEmitter } = require('node:events');
    const emitters: any[] = [];
    const watcher = () => { const emitter = Object.assign(new EventEmitter(), { close() {} }); emitters.push(emitter); return emitter; };
    let wakes = 0;
    const watched = watchSteam({ steam: '/steam', home: '/home', platform: 'linux', onLaunch: () => wakes++, onMarker: () => {}, log: () => {}, watcher: watcher as any });
    expect(watched.launchEvents()).toBe(true);
    emitters[1].emit('error', new Error('gone'));
    expect(watched.launchEvents()).toBe(false);
    expect(wakes).toBe(1);
});
