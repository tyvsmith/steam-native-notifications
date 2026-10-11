import { afterEach, expect, test } from 'bun:test';
import { createConnection } from 'node:net';
import { mkdtemp, mkdir, rm, stat, writeFile, symlink, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startControl, controlCall, controlPath } from './control';
const dirs: string[] = []; const stops: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of stops.splice(0)) await stop(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture(handler: Parameters<typeof startControl>[0]) { const dir = await mkdtemp(join(tmpdir(), 'snn-control-')); dirs.push(dir); const path = join(dir, 'private', 'control.sock'); stops.push(await startControl(handler, path)); return { dir, path }; }
test('socket and directory private; reads live handler; serialized callers', async () => {
    let busy = 0, peak = 0; const { path } = await fixture(async r => { peak = Math.max(peak, ++busy); await Bun.sleep(10); busy--; return r.id; });
    expect((await stat(path)).mode & 0o777).toBe(0o600); expect((await stat(join(path, '..'))).mode & 0o777).toBe(0o700);
    const replies = await Promise.all([controlCall('status', undefined, { path }), controlCall('status', undefined, { path })]); expect(replies[0]).not.toBe(replies[1]); expect(peak).toBe(1);
});
test('fragmented and pipelined newline frames correlate responses', async () => {
    const { path } = await fixture(async r => r.operation);
    const result = await new Promise<string>(resolve => { const socket = createConnection(path); let got = ''; socket.on('connect', () => { socket.write('{"id":"first",'); socket.write(`"deadline":${Date.now() + 1000},"operation":"status"}\n` + JSON.stringify({ id: 'second', deadline: Date.now() + 1000, operation: 'capture' }) + '\n'); }); socket.on('data', chunk => { got += chunk; if (got.split('\n').length === 3) { socket.destroy(); resolve(got); } }); });
    expect(result).toContain('"id":"first"'); expect(result).toContain('"id":"second"');
});
test('expiry and disconnect prevent queued commands executing', async () => {
    const seen: string[] = []; const { path } = await fixture(async r => { seen.push(r.operation); if (r.operation === 'status') await Bun.sleep(100); return 'ok'; });
    const first = controlCall('status', undefined, { path }); await Bun.sleep(10);
    await expect(controlCall('dev.fire', {}, { path, timeoutMs: 20 })).rejects.toThrow('timed out'); await first; await Bun.sleep(20); expect(seen).toEqual(['status']);
});
test('malformed, oversized and unknown operations close without execution', async () => {
    let calls = 0; const { path } = await fixture(async () => ++calls);
    for (const text of ['not-json\n', 'x'.repeat(65537), JSON.stringify({ id: 'bad', operation: 'eval', deadline: Date.now() + 1000 }) + '\n']) await new Promise<void>(resolve => { const socket = createConnection(path); socket.on('error', () => {}); socket.on('connect', () => socket.write(text)); socket.on('close', () => resolve()); });
    expect(calls).toBe(0);
});
test('refuses existing files and symlink directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snn-control-')); dirs.push(dir); await mkdir(join(dir, 'private')); const path = join(dir, 'private/control.sock'); await writeFile(path, 'keep'); await expect(startControl(async () => null, path)).rejects.toThrow('already exists');
    await symlink(join(dir, 'private'), join(dir, 'link')); await expect(startControl(async () => null, join(dir, 'link/control.sock'))).rejects.toThrow('Unsafe');
    const prior = process.env.XDG_RUNTIME_DIR; delete process.env.XDG_RUNTIME_DIR; expect(() => controlPath()).toThrow('XDG_RUNTIME_DIR'); process.env.XDG_RUNTIME_DIR = prior;
});

test('shutdown preserves a replacement file at the socket path', async () => {
    const { path } = await fixture(async () => null); await unlink(path); await writeFile(path, 'replacement');
    await stops.pop()!(); expect(await readFile(path, 'utf8')).toBe('replacement');
});

test('SIGKILL stale socket recovers only under the real exclusive daemon lock; live paths survive', async () => {
    const { acquireDaemonLock } = await import('./lock');
    const dir = await mkdtemp(join(tmpdir(), 'snn-crash-')); dirs.push(dir); const cache = join(dir, 'cache'); await mkdir(cache);
    const path = join(dir, 'private/control.sock');
    const program = `import { acquireDaemonLock } from ${JSON.stringify(join(import.meta.dir, 'lock.ts'))}; import { startControl } from ${JSON.stringify(join(import.meta.dir, 'control.ts'))}; const release = await acquireDaemonLock(${JSON.stringify(cache)}); await startControl(async () => 'child', ${JSON.stringify(path)}, { exclusiveLock: release }); console.log('ready');`;
    const child = Bun.spawn([process.execPath, '-e', program], { stdout: 'pipe', stderr: 'pipe' });
    try {
        const reader = child.stdout.getReader(); const ready = await reader.read(); reader.releaseLock(); expect(new TextDecoder().decode(ready.value)).toContain('ready');
        child.kill('SIGKILL'); await child.exited;
        const stale = await stat(path); expect(stale.isSocket()).toBe(true);
        await expect(startControl(async () => null, path)).rejects.toThrow('already exists');
        const release = await acquireDaemonLock(cache);
        try {
            const stop = await startControl(async () => 'recovered', path, { exclusiveLock: release });
            try {
                expect(await controlCall('status', undefined, { path })).toBe('recovered');
                await expect(startControl(async () => null, path, { exclusiveLock: release })).rejects.toThrow('live');
                expect(await controlCall('status', undefined, { path })).toBe('recovered');
            } finally { await stop(); }
            await writeFile(path, 'replacement');
            await expect(startControl(async () => null, path, { exclusiveLock: release })).rejects.toThrow('already exists');
            expect(await readFile(path, 'utf8')).toBe('replacement');
        } finally { await release(); }
    } finally { child.kill(); await child.exited; }
});
