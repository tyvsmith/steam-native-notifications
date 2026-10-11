import { expect, test } from 'bun:test';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
async function fixture() {
    const seams: Record<string, string> = {
        './host': "export const hostMethod = () => async () => '';",
        './settings': "export const settings = () => ({devFire:true}); export const parseCallableJson = (raw,fallback) => fallback;",
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
    const context: any = createContext({ Date, setTimeout, setInterval: () => 1, clearInterval: () => {}, invoked: 0, SteamClient: {}, module: { exports: {} }, surface: async () => ({ focusedAppId: 0 }) }); context.window = context;
    runInContext(await built.outputs[0]!.text(), context); const api = context.module.exports;
    const stop = api.startDevFirePoll();
    const request = (command: any, ms = 1000) => ({ id: 'fixture', createdAt: Date.now(), deadline: Date.now() + ms, command });
    return { context, api, stop, request };
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
