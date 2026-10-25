import { expect, test } from 'bun:test';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
async function fixture() {
    const seams: Record<string, string> = {
        './host': "export const hostMethod = name => async () => globalThis.pending?.[name] || '';",
        './settings': "export const settingsHost = {read:async () => { if (globalThis.savedEnabled !== undefined) globalThis.enabled = globalThis.savedEnabled; }}; export const settings = () => ({devFire:globalThis.enabled !== false}); export const parseCallableJson = (raw,fallback) => {try{return JSON.parse(raw)}catch{return fallback}};",
        './log': "export const dlog = () => {}; export const safeJson = JSON.stringify;",
        './overlay': "export const currentClickSurface = () => globalThis.surface();",
        './replay': "export const inspectReplayStash = () => {}; export const invokeReplayHandler = () => { globalThis.invoked++; return true; };",
        'millennium': "export const findModuleExport = predicate => [globalThis.steamPreferences, globalThis.serverStore].find(value => predicate(value));",
    };
    const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, '../frontend/devfire.ts')], target: 'browser', format: 'cjs', plugins: [{ name: 'fixture-seams', setup(build) {
        build.onResolve({ filter: /^(\.\/(host|settings|log|overlay|replay)|millennium)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: seams[args.path]!, loader: 'js' }));
    } }] });
    if (!built.success) throw new Error(built.logs.join('\n'));
    const context: any = createContext({ Date, setTimeout, setInterval: (fn: any) => { context.tick = fn; return 1; }, clearInterval: () => {}, invoked: 0, SteamClient: {}, steamPreferences: { GetClientSetting() {}, clientSettings: {}, friendSettings: { bNotifications_ShowOnline: true } }, module: { exports: {} }, surface: async () => ({ focusedAppId: 0 }) }); context.window = context;
    runInContext(await built.outputs[0]!.text(), context); const api = context.module.exports;
    context.serverNotifications = [];
    context.serverStore = { OnServerNotification: (rollup: any) => context.serverNotifications.push(rollup), MarkItemRead() {}, BToastEnabled: () => context.generalEnabled !== false };
    context.NotificationStore = { BIsUserInGame: () => false };
    const receipts: any[] = []; const stop = api.startDevControl();
    const request = (command: any, ms = 1000) => ({ id: 'fixture', createdAt: Date.now(), deadline: Date.now() + ms, command });
    return { context, api, stop, request, receipts };
}
test('replay expires during awaited surface discovery without invoking a handler', async () => {
    const f = await fixture(); f.context.surface = async () => { await Bun.sleep(40); return { focusedAppId: 0 }; };
    try { await expect(f.api.executeDevCommand(f.request({ replay: { call: 'invoke' } }, 10))).rejects.toThrow('expired'); expect(f.context.invoked).toBe(0); }
    finally { f.stop(); }
});
test('replay refuses a frontend session stopped during discovery', async () => {
    const f = await fixture(); f.context.surface = async () => { f.stop(); return { focusedAppId: 0 }; };
    await expect(f.api.executeDevCommand(f.request({ replay: { call: 'invoke' } }))).rejects.toThrow('session'); expect(f.context.invoked).toBe(0);
});
test('overlay diagnostics propagate missing/rejected API and return measured success', async () => {
    const f = await fixture();
    try {
        const request = () => f.request({ overlay: { call: 'info' } });
        expect((await f.context.__snnDevControl(request())).ok).toBe(false);
        await expect(f.api.executeDevCommand(request())).rejects.toThrow('unavailable');
        f.context.SteamClient.Overlay = { GetOverlayBrowserInfo: async () => { throw new Error('fixture rejected'); } };
        const failed = await f.context.__snnDevControl(request()); expect(failed.ok).toBe(false); expect(failed.error).toContain('fixture rejected');
        f.context.SteamClient.Overlay.GetOverlayBrowserInfo = async () => ({ browsers: [123] });
        const success = await f.context.__snnDevControl(request()); expect(success.ok).toBe(true); expect(success.value.stage).toBe('executed'); expect(success.value.value).toEqual({ browsers: [123] });
    } finally { f.stop(); }
});
test('pushed fixed samples work with developer commands disabled and reject expiry', async () => {
    const f = await fixture(); let invoked = 0;
    f.context.enabled = false;
    f.context.NotificationStore = { TestFriendOnline: () => { invoked++; } };
    const envelope = f.request({ call: 'TestIncomingVoiceChat', args: [] });
    try {
        const result = await f.context.__snnDevControl(envelope, true);
        expect(invoked).toBe(0); expect(result.value.stage).toBe('executed');
        expect(f.context.serverNotifications[0].type).toBe(10);
        expect(JSON.parse(f.context.serverNotifications[0].item.body_data)).toMatchObject({ display_name: 'Steam Native Notifications', body: 'This is a test notification.', link: 'steam://settings/notifications' });
        const expired = await f.context.__snnDevControl({ ...envelope, deadline: Date.now() - 1 }, true);
        expect(invoked).toBe(0); expect(expired.ok).toBe(false);
    } finally { f.stop(); }
});

test('developer execution never reloads saved settings or installs idle polling', async () => {
    const f = await fixture(); let invoked = 0;
    f.context.enabled = false; f.context.savedEnabled = true;
    f.context.NotificationStore = { TestFriendOnline: () => { invoked++; } };
    try {
        expect(f.context.tick).toBeUndefined();
        await expect(f.api.executeDevCommand(f.request({ call: 'TestFriendOnline', args: [] }))).rejects.toThrow('disabled');
        expect(f.context.enabled).toBe(false); expect(invoked).toBe(0);
        f.context.enabled = true; f.context.savedEnabled = false;
        await f.api.executeDevCommand(f.request({ call: 'TestFriendOnline', args: [] }));
        expect(invoked).toBe(1); expect(f.context.enabled).toBe(true);
    } finally { f.stop(); }
});

test('host focus diagnostics normalize raw and quoted three-state replies', async () => {
    const f = await fixture();
    try {
        f.context.surface = () => { throw new Error('diagnostic must not query the surface twice'); };
        for (const raw of ['game', 'desktop', 'unknown', '"game"', '"desktop"', '"unknown"', '"broken', 'invalid']) {
            f.context.pending = { GameHostFocus: raw };
            const result = await f.api.executeDevCommand(f.request({ focus: { appid: 17 } }));
            const expected = raw.replaceAll('"', '');
            expect(result.value).toEqual({ appid: 17, host: ['game', 'desktop'].includes(expected) ? expected : 'unknown' });
        }
    } finally { f.stop(); }
});

test('branded sample respects General and global gates without requiring friend-online toasts', async () => {
    const f = await fixture();
    const sample = () => f.context.__snnDevControl(f.request({ call: 'TestIncomingVoiceChat', args: [] }), true);
    try {
        f.context.steamPreferences.friendSettings.bNotifications_ShowOnline = false;
        expect((await sample()).value.stage).toBe('executed'); expect(f.context.serverNotifications).toHaveLength(1);
        f.context.generalEnabled = false;
        expect((await sample()).error).toContain('General'); expect(f.context.serverNotifications).toHaveLength(1);
        f.context.generalEnabled = true;
        f.context.steamPreferences.clientSettings.disable_all_toasts = true;
        expect((await sample()).error).toContain('disabled'); expect(f.context.serverNotifications).toHaveLength(1);
        f.context.steamPreferences.clientSettings.disable_all_toasts = false;
        f.context.steamPreferences.clientSettings.disable_toasts_in_game = true;
        delete f.context.NotificationStore.BIsUserInGame;
        expect((await sample()).error).toContain('context is unavailable'); expect(f.context.serverNotifications).toHaveLength(1);
        f.context.NotificationStore.BIsUserInGame = () => true;
        expect((await sample()).error).toContain('in-game'); expect(f.context.serverNotifications).toHaveLength(1);
        f.context.NotificationStore.BIsUserInGame = () => false;
        expect((await sample()).value.stage).toBe('executed'); expect(f.context.serverNotifications).toHaveLength(2);
        delete f.context.serverStore.BToastEnabled;
        expect((await sample()).error).toContain('unavailable'); expect(f.context.serverNotifications).toHaveLength(2);
        f.context.steamPreferences = undefined;
        expect((await sample()).error).toContain('unavailable'); expect(f.context.serverNotifications).toHaveLength(2);
    } finally { f.stop(); }
});
