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
        'millennium': "export const findModuleExport = () => undefined;",
    };
    const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, '../frontend/devfire.ts')], target: 'browser', format: 'cjs', plugins: [{ name: 'fixture-seams', setup(build) {
        build.onResolve({ filter: /^(\.\/(host|settings|log|overlay|replay)|millennium)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: seams[args.path]!, loader: 'js' }));
    } }] });
    if (!built.success) throw new Error(built.logs.join('\n'));
    const context: any = createContext({ Date, setTimeout, setInterval: (fn: any) => { context.tick = fn; return 1; }, clearInterval: () => {}, invoked: 0, SteamClient: {}, module: { exports: {} }, surface: async () => ({ focusedAppId: 0 }) }); context.window = context;
    runInContext(await built.outputs[0]!.text(), context); const api = context.module.exports;
    const receipts: any[] = []; const stop = api.startDevFirePoll(async (id: string, result: any) => { receipts.push({id,result}); });
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
test('Millennium poll acknowledges fixed samples with developer commands disabled', async () => {
    const f = await fixture(); let invoked = 0;
    f.context.enabled = false;
    f.context.NotificationStore = { TestFriendOnline: () => { invoked++; } };
    const envelope = f.request({ call: 'TestIncomingVoiceChat', args: [] });
    f.context.pending = { TakeSampleCommand: JSON.stringify(envelope) };
    try {
        await f.context.tick();
        expect(invoked).toBe(1);
        expect(f.receipts[0].id).toBe(envelope.id);
        expect(f.receipts[0].result.value.stage).toBe('executed');
        f.context.pending.TakeSampleCommand = JSON.stringify({ ...envelope, deadline: Date.now() - 1 });
        await f.context.tick(); expect(invoked).toBe(1); expect(f.receipts[1].result.ok).toBe(false);
    } finally { f.stop(); }
});

test('idle and developer command ticks never reload saved settings', async () => {
    const f = await fixture(); let invoked = 0;
    f.context.enabled = false; f.context.savedEnabled = true;
    f.context.NotificationStore = { TestFriendOnline: () => { invoked++; } };
    f.context.pending = { TakeDevCommand: JSON.stringify(f.request({ call: 'TestFriendOnline', args: [] })) };
    try {
        await f.context.tick(); await f.context.tick();
        expect(f.context.enabled).toBe(false); expect(invoked).toBe(0);
        await expect(f.api.executeDevCommand(f.request({ call: 'TestFriendOnline', args: [] }))).rejects.toThrow('disabled');
        // Explicit refresh/panel writes update the snapshot outside this poll.
        f.context.enabled = true; f.context.savedEnabled = false;
        await f.context.tick(); expect(invoked).toBe(1);
        expect(f.context.enabled).toBe(true);
    } finally { f.stop(); }
});
