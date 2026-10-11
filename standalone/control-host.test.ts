import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Host } from './host';
import { controlHandler } from './control-host';
import { BUILD_IDENTITY } from '../shared/host';
test('real control handler reports live/stale identities and refuses disabled/unready/expired mutations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snn-control-host-')); const host = new Host(dir, join(dir, 'settings.json'), dir); const handle = controlHandler(host);
    const request = (operation: any, payload?: any) => ({ id: 'fixture', deadline: Date.now() + 1000, operation, payload });
    try {
        const status: any = await handle(request('status')); expect(status.state).toBe('disconnected'); expect(status.build).toEqual(BUILD_IDENTITY);
        await expect(handle(request('dev.fire', { call: 'TestFriendOnline', args: [] }))).rejects.toThrow('disabled');
        await expect(handle(request('sample'))).rejects.toThrow('unavailable');
        host.live = { state: 'ready', control: false, frontendBuild: { ...BUILD_IDENTITY, buildId: 'old' }, hook: 'unknown' }; host.frontendCommand = async () => ({ stage: 'executed' });
        expect((await handle(request('status')) as any).state).toBe('degraded'); await expect(handle(request('sample'))).rejects.toThrow('restart Steam');
        host.live.frontendBuild = BUILD_IDENTITY; host.live.control = true;
        expect((await handle(request('sample')) as any).stage).toBe('executed');
        await expect(handle({ ...request('sample'), deadline: 1 })).rejects.toThrow('expired');
        await handle(request('config.update', { devFire: true })); expect((await handle(request('dev.fire', { call: 'TestFriendOnline', args: [] })) as any).stage).toBe('executed');
    } finally { await rm(dir, { recursive: true, force: true }); }
});
