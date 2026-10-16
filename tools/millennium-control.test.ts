import { expect, test } from 'bun:test';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitForReply, millenniumReadiness, mailboxRequest } from './lib/millennium-control';
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
test('file replies ignore unrelated IDs and partial writes and expire without inferring success', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snn-reply-')); const path = join(root, 'reply');
    try {
        await writeFile(path, '{');
        expect(await waitForReply(path, 'wanted', Date.now() + 15)).toBeNull();
        await writeFile(path, JSON.stringify({ id: 'other', result: 'wrong' }));
        expect(await waitForReply(path, 'wanted', Date.now() + 15)).toBeNull();
        await writeFile(path, JSON.stringify({ id: 'wanted', result: 'measured' }));
        expect((await waitForReply(path, 'wanted', Date.now() + 100)).result).toBe('measured');
        expect(await waitForReply(path, 'wanted', Date.now() - 1)).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
});
test('overlapping readiness callers have independent replies and clean up on success or timeout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snn-mailbox-'));
    try {
        const calls = [mailboxRequest('status', undefined, 1000, root), mailboxRequest('status', undefined, 1000, root)];
        let requests: any[] = [];
        for (let attempt = 0; attempt < 50; attempt++) {
            requests = [];
            for (const name of await readdir(root)) { try { requests.push(JSON.parse(await readFile(join(root, name, 'status'), 'utf8'))); } catch {} }
            if (requests.length === 2) break;
            await Bun.sleep(5);
        }
        expect(requests).toHaveLength(2);
        for (const request of requests) await writeFile(join(root, request.id, 'result'), JSON.stringify({ id: request.id, hook: 'installed' }));
        const results = await Promise.all(calls);
        expect(new Set(results.map(r => r.id)).size).toBe(2);
        expect(await readdir(root)).toEqual([]);
        expect(await mailboxRequest('status', undefined, 15, root)).toBeNull();
        expect(await readdir(root)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
});
