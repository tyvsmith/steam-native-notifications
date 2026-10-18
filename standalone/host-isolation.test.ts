import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Host } from './host';
test('standalone refuses retired file consumers and leaves shared-cache evidence untouched', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snn-host-isolation-'));
    const runtime = join(dir, 'steam-native-notifications'); await mkdir(runtime);
    const host = new Host(runtime, join(dir, 'config.json'), dir);
    try {
        await writeFile(join(runtime, '.dev-fire'), 'historical evidence');
        for (const method of ['TakeDevCommand', 'TakeSampleCommand', 'TakeClick']) await expect(host.dispatch(method, [])).rejects.toThrow('Unsupported method');
        expect(await readFile(join(runtime, '.dev-fire'), 'utf8')).toBe('historical evidence');
    } finally { await rm(dir, { recursive: true, force: true }); }
});
