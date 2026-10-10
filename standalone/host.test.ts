import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Host, configValues, requestPayload } from './host';
const dirs: string[] = [];
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'snn-host-')); dirs.push(root);
    const host = new Host(join(root, 'steam-native-notifications'), join(root, 'settings.json'), root);
    await host.initialize(); return { root, host };
}
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
test('RPC validates IDs, methods, array arguments and size', () => {
    expect(requestPayload('{"id":1,"method":"Platform","args":[]}').id).toBe(1);
    for (const payload of ['{}', '{"id":-1,"method":"Notify","args":[]}', '{"id":1,"method":"Notify","args":{}}', 'x'.repeat(65537)]) expect(() => requestPayload(payload)).toThrow();
});
test('configuration defaults preserve Steam and reject malformed booleans', () => {
    expect(configValues({ showSteamOutsideGame: false, devFire: 'true', unknown: true })).toEqual({ ...configValues({}), showSteamOutsideGame: false });
    expect(configValues({}).showSteamOutsideGame).toBe(true);
});
test('host refuses unknown methods and malformed delivery arguments', async () => {
    const { host } = await fixture();
    expect(await host.dispatch('Platform', [])).toBe('linux');
    await expect(host.dispatch('Execute', ['rm'])).rejects.toThrow();
    await expect(host.dispatch('Notify', ['title'])).rejects.toThrow();
    expect(await host.dispatch('GameHostFocus', ['17'])).toBe('unknown');
});
test('settings refresh from file; deletion returns defaults', async () => {
    const { root, host } = await fixture();
    await writeFile(join(root, 'settings.json'), '{"notifyOutsideGame":false}');
    expect((await host.settings()).notifyOutsideGame).toBe(false);
    await rm(join(root, 'settings.json'));
    expect((await host.settings()).notifyOutsideGame).toBe(true);
});
test('identity selects MostRecent and preserves exact Steam IDs', async () => {
    const { root, host } = await fixture(); await mkdir(join(root, 'config'));
    await writeFile(join(root, 'config/loginusers.vdf'), '"users" { "76561198000000001" { "MostRecent" "0" } "76561198000000002" { "MostRecent" "1" } }');
    expect(JSON.parse(await host.dispatch('Identity', [])).steamid64).toBe('76561198000000002');
});
test('dev command is disabled by default and consumed once after opt-in', async () => {
    const { root, host } = await fixture(); const command = join(host.runtime, '.dev-fire'); await writeFile(command, '{"call":"test"}');
    expect(await host.dispatch('TakeDevCommand', [])).toBe('');
    await writeFile(join(root, 'settings.json'), '{"devFire":true}');
    expect(await host.dispatch('TakeDevCommand', [])).toBe('{"call":"test"}');
    expect(await host.dispatch('TakeDevCommand', [])).toBe('');
});
test('standalone logs do not truncate Millennium plugin logs', async () => {
    const { host } = await fixture(); const path = join(host.runtime, 'plugin.log'); await writeFile(path, 'previous');
    await host.initialize(); await host.dispatch('Log', ['hello\nworld']);
    expect(await readFile(path, 'utf8')).toBe('previous');
    expect(await readFile(join(host.runtime, 'standalone.log'), 'utf8')).toContain('hello world');
});

test('native delivery passes shell metacharacters as text through the real helper', async () => {
    const { root, host } = await fixture(); const bin = join(root, 'bin'); await mkdir(bin);
    const sent = join(root, 'sent.json'); const marker = join(root, 'unexpected');
    await writeFile(join(bin, 'notify-send'), `#!${process.execPath}\nawait Bun.write(${JSON.stringify(sent)}, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
    await writeFile(join(bin, 'gdbus'), '#!/bin/sh\ncase "$*" in *GetCapabilities*) printf "([\\x27body-markup\\x27],)\\n";; *GetServerInformation*) printf "(\\x27fixture\\x27,)\\n";; esac\n', { mode: 0o755 });
    const previousPath = process.env.PATH; process.env.PATH = `${bin}:${previousPath}`;
    try {
        const title = `Friend $(touch ${marker})`; const body = '`false`; <body>&';
        expect(await host.dispatch('Notify', [title, body, '', '', '', 'false'])).toBe('ok');
        let args: string[] | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
            try { args = JSON.parse(await readFile(sent, 'utf8')); break; } catch { await Bun.sleep(10); }
        }
        expect(args).toContain(title); expect(args?.join(' ')).toContain('`false`;');
        expect(await Bun.file(marker).exists()).toBe(false);
    } finally { process.env.PATH = previousPath; host.stop(); }
});
