import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigStore } from './config-store';
import { commandStore, configCommand } from './config-cli';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
test('offline writes and reset preserve unrelated, developer opt-in and Windows preferences', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snn-config-cli-')); roots.push(dir);
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ other: 42, devMode: true, notificationCenterOnlyInGame: true }));
    await configCommand(['set', 'integrationEnabled', 'false', '--config', path]);
    expect((await configCommand(['get', '--config', path])).values.integrationEnabled).toBe(false);
    await configCommand(['reset', '--config', path]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ other: 42, devMode: true, notificationCenterOnlyInGame: true, integrationEnabled: true });
    await writeFile(path, '{broken');
    await expect(configCommand(['reset', '--config', path])).rejects.toThrow('repair');
    expect(await readFile(path, 'utf8')).toBe('{broken');
});
test('reject invalid commands before locating or writing a config', async () => {
    const select = async (): Promise<ConfigStore> => { throw new Error('should not select'); };
    for (const args of [['set', 'devMode', 'yes'], ['reset', 'extra'], ['get', '--config'], ['get', '--config', '/a', '--config', '/b']])
        await expect(configCommand(args, select)).rejects.not.toThrow('should not select');
    await expect(commandStore('relative')).rejects.toThrow('absolute');
});
