import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Host } from './host';
test('real standalone and Millennium adapters sharing cache cannot steal the selected Millennium queue', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snn-host-isolation-')); const runtime = join(dir, 'steam-native-notifications'); await mkdir(runtime);
    const config = join(dir, 'standalone.json'); await writeFile(config, '{"devFire":true}');
    const host = new Host(runtime, config, dir);
    const envelope = JSON.stringify({ id: 'millennium-fixture', createdAt: Date.now(), deadline: Date.now() + 1000, command: { call: 'TestFriendOnline', args: [] } });
    await writeFile(join(runtime, '.dev-fire'), envelope);
    const lua = `for _, name in ipairs({"logger","millennium","json","fs"}) do package.preload[name] = function() return {} end end\ndofile(${JSON.stringify(resolve(import.meta.dir, '../backend/main.lua'))})\nio.write("ready\\n"); io.flush(); for i=1,200 do local go=io.open(${JSON.stringify(join(dir, 'consume'))},"r"); if go then go:close(); break end os.execute("sleep 0.01") end; io.write(TakeDevCommand()); io.flush()`;
    const child = Bun.spawn(['lua5.4', '-e', lua], { env: { ...process.env, XDG_CACHE_HOME: dir }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    try {
        const reader = child.stdout.getReader(); expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready');
        // Exercise standalone first to make an accidental shared-file consume deterministic.
        expect(await host.dispatch('TakeDevCommand', [])).toBe(''); await writeFile(join(dir, 'consume'), 'go');
        const [standalonePolls, millenniumCommand] = await Promise.all([Promise.all(Array.from({ length: 10 }, () => host.dispatch('TakeDevCommand', []))), (async () => { let text = ''; while (true) { const chunk = await reader.read(); if (chunk.done) return text; text += new TextDecoder().decode(chunk.value); } })()]);
        expect(standalonePolls).toEqual(Array(10).fill('')); expect(millenniumCommand).toBe(envelope); expect(await child.exited).toBe(0);
    } finally { child.kill(); await child.exited; await rm(dir, { recursive: true, force: true }); }
});
