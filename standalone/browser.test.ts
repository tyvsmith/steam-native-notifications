import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';

async function fixture() {
    const bundle = await readFile(resolve(import.meta.dir, '../dist/standalone/frontend.js'), 'utf8');
    const calls: any[] = []; const hooks: any[] = []; let registrations = 0;
    const context: any = createContext({ console, crypto, Uint8Array, TextEncoder, TextDecoder, btoa, atob,
        setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
        __snnInitialConfig: { notifyOutsideGame: true, notifyInGame: true, showSteamOutsideGame: true, showSteamInGame: true },
        g_PopupManager: { AddPopupCreatedCallback(callback: any) { hooks.push(callback); return { Unregister() {} }; }, AddPopupDestroyedCallback() { return { Unregister() {} }; } },
        SteamClient: { URL: { RegisterForRunSteamURL() { registrations++; return { unregister() {} }; }, GetSteamURLList: async () => ({}) }, System: { UI: { RegisterForOverlayGameWindowFocusChanged() {} } } },
    });
    context.window = context;
    context.__snnHost = (payload: string) => {
        const call = JSON.parse(payload); calls.push(call);
        const value = call.method === 'Platform' ? 'linux' : call.method === 'Identity' ? '{}' : 'ok';
        queueMicrotask(() => context.__snnReply(call.id, value));
    };
    const inject = () => runInContext(`if (!globalThis.__snnStandaloneStarted) { ${bundle}\n }`, context);
    inject(); await Bun.sleep(10);
    return { context, calls, hooks, inject, registrations: () => registrations };
}
test('real standalone bundle initializes capture and URL bridge once across reattachment', async () => {
    const f = await fixture(); f.inject(); await Bun.sleep(10);
    expect(f.hooks.length).toBe(1); expect(f.registrations()).toBe(1);
    expect(f.calls.some(call => call.method === 'Log' && call.args[0] === 'hook installed')).toBe(true);
});
test('real capture forwards localized text and artwork; delivery failure preserves Steam', async () => {
    const f = await fixture(); let closed = 0;
    const popup = { window: { name: 'notificationtoasts_1_desktop', closed: false, close() { closed++; }, document: { body: { innerText: 'Friend online\nLocalized body', querySelectorAll: (): unknown[] => [], children: [] as unknown[] }, images: [{ src: 'https://avatars.steamstatic.com/avatar.jpg' }] } } };
    f.hooks[0](popup); await Bun.sleep(30);
    const notify = f.calls.find(call => call.method === 'Notify');
    expect(notify.args.slice(0, 3)).toEqual(['Friend online', 'Localized body', 'https://avatars.steamstatic.com/avatar.jpg']);
    expect(notify.args[3]).toStartWith('click:'); expect(closed).toBe(0);
    f.context.__snnConfig({ notifyOutsideGame: true, showSteamOutsideGame: false });
    f.context.__snnHost = (payload: string) => { const call = JSON.parse(payload); queueMicrotask(() => f.context.__snnReply(call.id, call.method === 'Notify' ? 'unsupported' : 'ok')); };
    popup.window.name = 'notificationtoasts_2_desktop'; f.hooks[0](popup); await Bun.sleep(30); expect(closed).toBe(0);
});
test('narrow webpack lookup resolves store without loading unrelated factories', async () => {
    const f = await fixture(); let unrelated = 0;
    const store = { OnGameOverlayActivateRequested() {}, OnSteamURLOpenExternalForPID() {} };
    const requireModule: any = (id: string) => id === 'store' ? { store } : (() => { unrelated++; return {}; })();
    requireModule.m = { store: function OnGameOverlayActivateRequested() {}, other: function unrelatedFactory() {} };
    f.context.webpackChunksteamui = []; f.context.webpackChunksteamui.push = (chunk: any) => { chunk[2](requireModule); return 1; };
    const result = await Bun.build({ entrypoints: [resolve(import.meta.dir, 'adapter.ts')], target: 'browser', format: 'cjs' });
    expect(result.success).toBe(true);
    f.context.module = { exports: {} }; f.context.exports = f.context.module.exports;
    runInContext(await result.outputs[0]!.text(), f.context);
    const found = f.context.module.exports.findModuleExport((e: any) => typeof e?.OnGameOverlayActivateRequested === 'function' && typeof e?.OnSteamURLOpenExternalForPID === 'function');
    expect(found).toBe(store); expect(unrelated).toBe(0);
});
