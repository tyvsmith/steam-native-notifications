import { sampleCommand } from '../shared/dev-command';
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
test('configuration defaults replace desktop Steam and retain in-game defaults and reject malformed booleans', () => {
    expect(configValues({ showSteamOutsideGame: false, devFire: 'true', unknown: true })).toEqual({ ...configValues({}), showSteamOutsideGame: false });
    expect(configValues({}).showSteamOutsideGame).toBe(false);
    expect(configValues({}).showSteamInGame).toBe(true);
    expect(configValues({}).devFire).toBe(false);
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
test('Millennium command queue remains untouched even after standalone dev opt-in', async () => {
    const { root, host } = await fixture(); const command = join(host.runtime, '.dev-fire'); await writeFile(command, '{"call":"test"}');
    await expect(host.dispatch('TakeDevCommand', [])).rejects.toThrow('Unsupported method');
    await writeFile(join(root, 'settings.json'), '{"devFire":true}');
    await expect(host.dispatch('TakeDevCommand', [])).rejects.toThrow('Unsupported method');
    expect(await readFile(command, 'utf8')).toBe('{"call":"test"}');
    await expect(host.dispatch('TakeDevCommand', [])).rejects.toThrow('Unsupported method');
});
test('standalone logs do not truncate Millennium plugin logs', async () => {
    const { host } = await fixture(); const path = join(host.runtime, 'plugin.log'); await writeFile(path, 'previous');
    await host.initialize(); await host.dispatch('Log', ['hello\nworld']);
    expect(await readFile(path, 'utf8')).toBe('previous');
    expect(await readFile(join(host.runtime, 'standalone.log'), 'utf8')).toContain('hello world');
});

test('native delivery honors changed PATH and passes shell metacharacters through the real helper', async () => {
    const { root, host } = await fixture(); const bin = join(root, 'bin'); await mkdir(bin);
    const sent = join(root, 'sent.json'); const marker = join(root, 'unexpected');
    await writeFile(join(bin, 'notify-send'), `#!${process.execPath}\nawait Bun.write(${JSON.stringify(sent)}, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
    await writeFile(join(bin, 'gdbus'), '#!/bin/sh\ncase "$*" in *GetCapabilities*) printf "([\\x27body-markup\\x27],)\\n";; *GetServerInformation*) printf "(\\x27fixture\\x27,)\\n";; esac\n', { mode: 0o755 });
    try {
        const title = `Friend $(touch ${marker})`; const body = '`false`; <body>&';
        const program = `import { Host } from ${JSON.stringify(join(import.meta.dir, 'host.ts'))}; process.env.PATH=${JSON.stringify(bin + ':' + process.env.PATH)}; const host=new Host(${JSON.stringify(host.runtime)},${JSON.stringify(host.config)},${JSON.stringify(host.steam)}); console.log(await host.dispatch('Notify', ${JSON.stringify([title, body, '', '', '', 'false'])}));`;
        const child = Bun.spawn([process.execPath, '-e', program], { env: { ...process.env, PATH: '/no-startup-tools' }, stdout: 'pipe', stderr: 'pipe' });
        expect((await new Response(child.stdout).text()).trim()).toBe('ok');
        expect(await child.exited).toBe(0);
        let args: string[] | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
            try { args = JSON.parse(await readFile(sent, 'utf8')); break; } catch { await Bun.sleep(10); }
        }
        expect(args).toContain(title); expect(args?.join(' ')).toContain('`false`;');
        expect(await Bun.file(marker).exists()).toBe(false);
    } finally { host.stop(); }
});

test('nonstandard Steam artwork root takes precedence without modifying shared Steam settings', async () => {
    const { root, host } = await fixture();
    const art = join(root, 'custom-steam/appcache/librarycache/1073390/art.png');
    await mkdir(join(art, '..'), { recursive: true }); await writeFile(art, 'artwork');
    await writeFile(join(host.runtime, 'steam-dir'), '/preexisting-millennium-root');
    const child = Bun.spawn(['sh', join(import.meta.dir, '../tools/notify-action'), '--resolve-icon', 'https://steamloopback.host/assets/1073390/art.png'], {
        env: { ...process.env, XDG_CACHE_HOME: root, SNN_STEAM_DIR: join(root, 'custom-steam') }, stdout: 'pipe', stderr: 'pipe',
    });
    expect((await new Response(child.stdout).text()).trim()).toBe(art);
    expect(await child.exited).toBe(0);
    expect(await readFile(join(host.runtime, 'steam-dir'), 'utf8')).toBe('/preexisting-millennium-root');
});

test('panel settings restrict writes and preserve hidden settings on reset', async () => {
    const { host } = await fixture();
    await host.store.update({ notificationCenterOnlyInGame: true, devMode: true });
    const state = JSON.parse(await host.dispatch('PanelRead', []));
    expect(state.config.values.notifyOutsideGame).toBe(true);
    await host.dispatch('PanelPatch', [{ notifyOutsideGame: false }]);
    expect((await host.settings()).notifyOutsideGame).toBe(false);
    for (const patch of [{ devMode: false }, { notificationCenterOnlyInGame: false }, { notifyInGame: 'yes' }, { arbitrary: true }]) {
        await expect(host.dispatch('PanelPatch', [patch])).rejects.toThrow();
    }
    await host.dispatch('PanelReset', []);
    expect((await host.settings()).notificationCenterOnlyInGame).toBe(true);
    expect((await host.settings()).devMode).toBe(true);
    expect((await host.settings()).notifyOutsideGame).toBe(true);
    await host.store.update({ devMode: false });
    await expect(host.dispatch('PanelPatch', [{ devFire: true }])).rejects.toThrow();
});
test('panel sample is fixed and rejects stale frontend and arbitrary arguments', async () => {
    const { host } = await fixture();
    await expect(host.dispatch('PanelSample', [])).rejects.toThrow();
    const { BUILD_IDENTITY } = await import('../shared/host');
    host.live = { state: 'ready', frontendBuild: BUILD_IDENTITY, control: true };
    host.frontendCommand = async (envelope, sample) => ({ command: envelope.command, sample });
    expect(JSON.parse(await host.dispatch('PanelSample', []))).toEqual({ command: sampleCommand(), sample: true });
    await expect(host.dispatch('PanelSample', ['TestIncomingVoiceChat'])).rejects.toThrow();
});

for (const line of (await Bun.file(join(import.meta.dir, '../shared/login-users.fixtures.tsv')).text()).trimEnd().split('\n')) {
    const [name, expected, text] = line.split('\t');
    test(`identity corpus: ${name}`, async () => {
        const { root, host } = await fixture(); await mkdir(join(root, 'config'));
        await writeFile(join(root, 'config/loginusers.vdf'), text);
        expect(JSON.parse(await host.dispatch('Identity', [])).steamid64).toBe(expected === '-' ? undefined : expected);
    });
}
