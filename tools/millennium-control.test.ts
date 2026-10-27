import { takeFrame, frame } from './lib/mep';
import { decode, encode } from './lib/msgpack';
import { expect, test } from 'bun:test';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { millenniumReadiness, pushRequest } from './lib/millennium-control';
import { BUILD_IDENTITY } from '../shared/host';
test('readiness requires matching build, protocol, hook and live control', () => {
    const good = { frontendBuild: BUILD_IDENTITY, hook: 'installed', control: true };
    expect(millenniumReadiness(good).state).toBe('ready');
    for (const change of [{ frontendBuild: { ...BUILD_IDENTITY, buildId: 'old' } }, { frontendBuild: { ...BUILD_IDENTITY, protocolVersion: 99 } }, { hook: 'failed' }, { control: false }]) {
        expect(millenniumReadiness({ ...good, ...change }).capabilities.sample).toBe(false);
    }
    expect(millenniumReadiness(null).state).toBe('backend-running');
    expect(millenniumReadiness(null).capabilities.developerCommands).toBe(false);
});
test('push transport correlates overlapping replies, expires and deletes transient config keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snn-push-'));
    const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\snn-push-${crypto.randomUUID()}` : join(root, 'mep.sock');
    const deleted: string[] = []; let respond = true;
    const buffers = new Map<any, Uint8Array>();
    const server = Bun.listen({ unix: socketPath, socket: {
        data(socket, data) {
            const got = takeFrame(Buffer.concat([buffers.get(socket) ?? new Uint8Array(), data]));
            if (!got) { buffers.set(socket, data); return; }
            const request: any = decode(got.body); const p = request.params;
            let result: any = {};
            if (request.method === 'plugin.config.delete') deleted.push(p.key);
            if (request.method === 'plugin.config.set' && respond) {
                const value = JSON.parse(p.value);
                expect(typeof value.deadline).toBe('string');
                expect(Number(value.deadline)).toBeGreaterThan(Date.now());
                void writeFile(join(root, value.id, 'result'), JSON.stringify({ id: value.id, settingsRefreshed: true }));
            }
            socket.end(frame(encode({ id: request.id, error: null, result })));
        }, close(socket) { buffers.delete(socket); },
    } });
    try {
        const replies = await Promise.all([pushRequest('status', undefined, 1000, root, { socketPath }), pushRequest('status', 'refresh-settings', 1000, root, { socketPath })]);
        expect(replies.every(r => r?.settingsRefreshed)).toBe(true);
        expect(new Set(replies.map(r => r.id)).size).toBe(2);
        expect(deleted).toEqual(['snnControl', 'snnControl']);
        respond = false;
        expect(await pushRequest('dev', {}, 30, root, { socketPath })).toBeNull();
        expect((await readdir(root)).filter(n => n !== 'mep.sock')).toEqual([]);
    } finally { server.stop(true); await rm(root, { recursive: true, force: true }); }
});
