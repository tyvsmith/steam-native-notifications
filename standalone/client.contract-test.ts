import { expect, mock, test } from 'bun:test';
import { BUILD_IDENTITY } from '../shared/host';
import { DEFAULTS } from '../shared/settings';
let failRead = false, failSetKey = '', exitOnRefresh = false;
let standalone = true, millennium = true, failWrite = false; let refreshes = 0, refreshed = true; let probeError = 'ENOENT'; let settings = { ...DEFAULTS }; const queued: any[] = [];
mock.module('../tools/lib/mep', () => ({ mepCall: async (method: string, params: any): Promise<any> => {
    if (!millennium) throw Object.assign(new Error('offline'), { code: probeError });
    if (method === 'plugin.status') return { error: null, result: { running: true } };
    if (method === 'plugin.config.get_all' && failRead) throw new Error('readback unavailable');
    if (method === 'plugin.config.get_all') return { error: null, result: { config: settings } };
    if (method === 'plugin.config.set' && params.key === failSetKey) throw new Error('write interrupted');
    if (method === 'plugin.config.set') { (settings as any)[params.key] = params.value; return { error: null, result: null }; }
    throw new Error('unsupported');
} }));
mock.module('./control', () => ({ controlCall: async (operation: string, payload: any): Promise<any> => {
    if (!standalone) throw Object.assign(new Error('offline'), { code: probeError });
    if (operation === 'status') return { host: 'standalone', state: 'ready', build: BUILD_IDENTITY, capabilities: {settingsWrite:true,sample:true,developerCommands:true} };
    if (operation === 'config.read') return { values: settings, error: null };
    if (operation === 'config.update') { settings = { ...settings, ...payload }; if (failWrite) throw Error('reply lost after commit'); return { values: settings, error: null }; }
    if (operation === 'sample' || operation === 'dev.fire') return { stage: 'executed' };
    return { lines: [] };
} }));
mock.module('../tools/lib/millennium-control', () => ({
    refreshMillenniumSettings: async () => { refreshes++; if (exitOnRefresh) millennium = false; return { refreshed, message: refreshed ? 'Running settings refreshed' : 'Settings saved; live reload unconfirmed' }; },
    probeMillennium: async () => ({ frontendBuild: BUILD_IDENTITY, hook: 'installed', control: true }),
    millenniumReadiness: () => ({ state: 'ready', frontendBuild: BUILD_IDENTITY, capabilities: {settingsWrite:true,sample:true,developerCommands:true} }),
    millenniumCommand: async (command: any, sample: boolean) => { queued.push({ command, kind: sample ? 'sample' : 'dev' }); return { stage: 'executed' }; },
}));
mock.module('../tools/lib/snn', () => ({ PLUGIN_ID: 'fixture', writeDevFire: (command: any) => queued.push(command), writeCommandFile: (command: any, kind: any) => queued.push({ ...command, kind }), readPluginLog: () => ['historical'] }));
mock.module('../tools/lib/cli/capture-millennium', () => ({ captureReport: async () => ['full diagnostic fixture'] }));
const { fire, sample, capture, readConfig, updateConfig, resetConfig, selectHost, hostStatus } = await import('../tools/lib/host-client');
for (const host of ['standalone', 'millennium'] as const) {
    test(`${host}: shared settings, diagnostics, developer gate and narrow sample scenario`, async () => {
        settings = { ...DEFAULTS }; queued.length = 0;
        expect((await readConfig(host)).values.devFire).toBe(false);
        if (host === 'millennium') await expect(fire({ call: 'TestFriendOnline', args: [] }, host)).rejects.toThrow('disabled');
        await updateConfig({ devFire: true, notifyInGame: false }, host); expect((await readConfig(host)).values.notifyInGame).toBe(false);
        const fired: any = await fire({ call: 'TestFriendOnline', args: [] }, host); expect(fired.stage).toBe('executed');
        await expect(fire({ call: 'TestIncomingVoiceChat', args: [] }, host)).rejects.toThrow('blocked'); await expect(fire({ call: 'eval', args: [] }, host)).rejects.toThrow('Unsupported');
        expect((await sample(host) as any).stage).toBe('executed');
        if (host === 'millennium') { expect(queued[1].kind).toBe('sample'); expect(queued[1].command).toBeUndefined(); }
        await resetConfig(host); expect((await readConfig(host)).values).toEqual(DEFAULTS); expect(await capture(1, host)).toBeDefined();
    });
}
test('ambiguous automatic mutation refused; readonly status shows both; stopped explicit mutations refused', async () => {
    expect((await hostStatus()).length).toBe(2); await expect(selectHost('auto', true)).rejects.toThrow('Both');
    millennium = false; expect(await selectHost('auto', true)).toBe('standalone'); standalone = false;
    await expect(selectHost('auto', true)).rejects.toThrow('No ready'); await expect(selectHost('standalone', true)).rejects.toThrow('not ready'); standalone = true; millennium = true;
});

test('a possibly applied daemon mutation is not retried in the offline store', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const root = await mkdtemp(tmpdir() + '/snn-no-retry-');
    const previousRuntime = process.env.XDG_RUNTIME_DIR, previousConfig = process.env.XDG_CONFIG_HOME;
    process.env.XDG_RUNTIME_DIR = root; process.env.XDG_CONFIG_HOME = root;
    failWrite = true;
    try {
        await expect(updateConfig({ notifyOutsideGame: false }, 'standalone')).rejects.toThrow('reply lost');
        expect(settings.notifyOutsideGame).toBe(false);
        expect(await Bun.file(root + '/steam-native-notifications/standalone.json').exists()).toBe(false);
    } finally {
        failWrite = false;
        if (previousRuntime === undefined) delete process.env.XDG_RUNTIME_DIR; else process.env.XDG_RUNTIME_DIR = previousRuntime;
        if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previousConfig;
        await rm(root, { recursive: true, force: true });
    }
});

test('automatic config selection refuses ambiguity and supports a host with capture unavailable', async () => {
    const { selectConfigHost } = await import('../tools/lib/host-client');
    expect(selectConfigHost([{ host: 'millennium', present: true, state: 'degraded' }])).toBe('millennium');
    expect(() => selectConfigHost([])).toThrow('offline recovery');
    await expect(updateConfig({ devMode: true }, 'auto')).rejects.toThrow('Both hosts');
    millennium = false;
    try {
        await updateConfig({ devMode: true }, 'auto');
        expect((await readConfig('auto')).values.devMode).toBe(true);
    } finally { millennium = true; settings = { ...DEFAULTS }; }
});

test('shared developer CLI dispatcher routes sample, replay and server through the selected host', async () => {
    const { developerCommand } = await import('../tools/lib/cli/developer-command');
    settings = { ...DEFAULTS, devFire: true }; queued.length = 0;
    await developerCommand(['--sample'], 'millennium');
    await developerCommand(['--replay', 'inspect'], 'millennium');
    await developerCommand(['--server', '3', '{"appid":570}'], 'millennium');
    expect(queued).toEqual([
        { command: undefined, kind: 'sample' },
        { command: { replay: { call: 'inspect' } }, kind: 'dev' },
        { command: { server: { type: 3, body: { appid: 570 } } }, kind: 'dev' },
    ]);
    await expect(developerCommand(['TestIncomingVoiceChat'], 'millennium')).rejects.toThrow('blocked');
    settings = { ...DEFAULTS };
});

for (const code of ['ETIMEDOUT', 'EACCES', 'EPROTO']) {
    test(`automatic config refuses inconclusive ${code} probe without writing the other host`, async () => {
        settings = { ...DEFAULTS }; millennium = false; probeError = code;
        try {
            expect((await hostStatus()).find(host => host.host === 'millennium')).toMatchObject({ present: null, state: 'unknown' });
            await expect(updateConfig({ devMode: true }, 'auto')).rejects.toThrow('inconclusive');
            expect(settings.devMode).toBe(false);
            await expect(sample('auto')).rejects.toThrow('inconclusive');
        } finally { millennium = true; probeError = 'ENOENT'; }
    });
}
test('connection refusal proves absence for automatic config selection', async () => {
    millennium = false; probeError = 'ECONNREFUSED';
    try { await updateConfig({ devMode: true }, 'auto'); expect(settings.devMode).toBe(true); }
    finally { millennium = true; probeError = 'ENOENT'; settings = { ...DEFAULTS }; }
});

test('Millennium config writes explicitly reload once and preserve saved/unconfirmed outcome', async () => {
    refreshes = 0;
    await readConfig('millennium'); expect(refreshes).toBe(0);
    const confirmed = await updateConfig({ devMode: true, devFire: true }, 'millennium');
    expect(refreshes).toBe(1); expect(confirmed.runtime?.refreshed).toBe(true);
    refreshed = false;
    try {
        const result = await updateConfig({ devFire: false }, 'millennium');
        expect(result.values.devFire).toBe(false); expect(result.error).toBeNull();
        expect(result.runtime?.refreshed).toBe(false); expect(refreshes).toBe(2);
    } finally { refreshed = true; settings = { ...DEFAULTS }; }
});

test('saved settings survive Steam exiting during the reload wait', async () => {
    exitOnRefresh = true; refreshed = false;
    try {
        const result = await updateConfig({ devMode: true }, 'millennium');
        expect(result.values.devMode).toBe(true);
        expect(result.runtime?.refreshed).toBe(false);
    } finally { exitOnRefresh = false; millennium = true; refreshed = true; settings = { ...DEFAULTS }; }
});

test('post-save readback failure reports saved state and still requests reload', async () => {
    failRead = true; refreshed = false; refreshes = 0;
    try {
        await expect(updateConfig({ devMode: true }, 'millennium')).rejects.toThrow('Settings saved, but readback failed. Live reload unconfirmed');
        expect(settings.devMode).toBe(true); expect(refreshes).toBe(1);
    } finally { failRead = false; refreshed = true; settings = { ...DEFAULTS }; }
});

test('partial writes request reload without retrying the failed mutation', async () => {
    failSetKey = 'devFire'; refreshes = 0;
    try {
        await expect(updateConfig({ devMode: true, devFire: true }, 'millennium')).rejects.toThrow('some values may have been saved');
        expect(settings.devMode).toBe(true); expect(settings.devFire).toBe(false); expect(refreshes).toBe(1);
    } finally { failSetKey = ''; settings = { ...DEFAULTS }; }
});
