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
    const preferences = { GetClientSetting() {}, clientSettings: {}, friendSettings: { bNotifications_ShowOnline: true } };
    const requireModule: any = () => ({ preferences });
    requireModule.m = { settings: function GetClientSetting() {} };
    context.webpackChunksteamui = [];
    context.webpackChunksteamui.push = (chunk: any) => { chunk[2](requireModule); return 1; };
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

test('shared developer execution gates unsafe/disabled/expired/restarted requests; fixed sample ignores supplied command', async () => {
    const f = await fixture(); let fired = 0;
    f.context.NotificationStore = { TestFriendOnline() { fired++; }, TestFriendMessage() { throw new Error('fixture failure'); } };
    const request = (command: any) => ({ id: crypto.randomUUID(), createdAt: Date.now(), deadline: Date.now() + 1000, command });
    const execute = f.context.__snnDevControl;
    expect((await execute(request({ call: 'TestFriendOnline', args: [] }))).error).toContain('disabled');
    expect((await execute(request({ call: 'anything', args: [] }), true)).value.stage).toBe('executed'); expect(fired).toBe(1);
    f.context.__snnConfig({ devFire: true });
    expect((await execute(request({ call: 'TestIncomingVoiceChat', args: [] }))).error).toContain('blocked');
    expect((await execute(request({ call: 'eval', args: [] }))).error).toContain('Unsupported');
    expect((await execute({ ...request({ call: 'TestFriendOnline', args: [] }), deadline: 1 })).error).toContain('expired');
    expect((await execute({ ...request({ call: 'TestFriendOnline', args: [] }), createdAt: 1 }, true)).error).toContain('predates');
    expect((await execute(request({ call: 'TestFriendMessage', args: [] }))).error).toContain('fixture failure');
    expect((await execute(request({ call: 'TestFriendOnline', args: [] }))).value.stage).toBe('executed'); expect(fired).toBe(2);
});

test('real standalone bundle applies master off and restores preferences without duplicate hooks', async () => {
    const f = await fixture(); let closed = 0;
    const preferences = { notifyOutsideGame: true, showSteamOutsideGame: false, notifyInGame: false, showSteamInGame: false };
    const popup = (name: string) => {
        const doc: any = { body: { innerText: 'Download complete\nAircar', children: [] }, images: [] };
        const id = name.endsWith('_desktop') ? name.split('_')[1] : name.split('-')[1];
        const fiber = { memoizedProps: { notification: { notificationID: id }, onDismiss() { closed++; } },
            return: { tag: 4, stateNode: { containerInfo: { ownerDocument: doc } } } };
        doc.querySelectorAll = () => [{ __reactFiber$test: fiber }];
        return { window: { name, close() { throw Error('Raw CEF close bypasses lifecycle'); }, document: doc } };
    };
    f.context.__snnConfig({ ...preferences, integrationEnabled: false });
    f.hooks[0](popup('notificationtoasts_20_desktop')); f.hooks[0](popup('notificationtoasts_uid570-21'));
    await Bun.sleep(30);
    expect(f.calls.filter(call => call.method === 'Notify')).toHaveLength(0); expect(closed).toBe(0);
    f.context.__snnConfig({ ...preferences, integrationEnabled: true });
    f.hooks[0](popup('notificationtoasts_22_desktop')); f.hooks[0](popup('notificationtoasts_uid570-23'));
    await Bun.sleep(30);
    expect(f.calls.filter(call => call.method === 'Notify')).toHaveLength(1); expect(closed).toBe(2);
    expect(f.hooks).toHaveLength(1);
    // A toast already awaiting delivery must survive removal too.
    let delivery: any;
    f.context.__snnHost = (payload: string) => {
        const call = JSON.parse(payload); f.calls.push(call);
        if (call.method === 'Notify') delivery = call;
        else queueMicrotask(() => f.context.__snnReply(call.id, 'ok'));
    };
    f.hooks[0](popup('notificationtoasts_24_desktop')); await Bun.sleep(30);
    expect(delivery).toBeDefined();
    f.context.__snnRemove(); f.context.__snnReply(delivery.id, 'ok'); await Bun.sleep(30);
    expect(closed).toBe(2);
    // Stale saved-config pushes cannot reactivate this removed browser session.
    f.context.__snnConfig({ ...preferences, integrationEnabled: true, notifyOutsideGame: false });
    const delivered = f.calls.filter(call => call.method === 'Notify').length;
    f.hooks[0](popup('notificationtoasts_25_desktop')); f.hooks[0](popup('notificationtoasts_uid570-26'));
    await Bun.sleep(30);
    expect(closed).toBe(2);
    expect(f.calls.filter(call => call.method === 'Notify')).toHaveLength(delivered);
});

test('commands apply newly saved settings to the real runtime before the polling refresh', async () => {
    const { attach } = await import('./daemon');
    const { ConfigStore } = await import('./config-store');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(tmpdir() + '/snn-command-config-');
    const store = new ConfigStore(dir + '/settings.json');
    const f = await fixture(); let running = true; let sequence = 800;
    await store.update({ integrationEnabled: false, showSteamOutsideGame: true });
    f.context.__snnConfig((await store.read()).values);
    f.context.NotificationStore = { TestFriendOnline() {
        f.hooks[0]({ window: { name: `notificationtoasts_${sequence++}_desktop`, close() { throw Error('must preserve Steam'); },
            document: { body: { innerText: 'Sample\nCurrent preferences' }, images: [] as unknown[], querySelectorAll: (): unknown[] => [] } } });
    } };
    const client: any = { onEvent() {}, closed: new Promise(() => {}), async call(method: string, params: any) {
        if (method === 'Runtime.enable') this.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 1, auxData: { isDefault: true } } } });
        if (!params?.expression) return {};
        return { result: { value: await runInContext(params.expression, f.context) } };
    } };
    const host: any = { store, live: {}, settings: async () => (await store.read()).values, log: async () => {},
        async readiness() {
            const command = () => host.frontendCommand({ id: crypto.randomUUID(), createdAt: Date.now(), deadline: Date.now() + 2000, command: { call: 'TestFriendOnline', args: [] } }, true);
            await store.update({ integrationEnabled: true });
            await command(); await Bun.sleep(30);
            expect(f.calls.filter(call => call.method === 'Notify')).toHaveLength(1);
            await store.update({ integrationEnabled: false });
            await command(); await Bun.sleep(30);
            expect(f.calls.filter(call => call.method === 'Notify')).toHaveLength(1);
            running = false;
        } };
    try { await attach(client, '/* already injected runtime */', host, () => running); }
    finally { running = false; await rm(dir, { recursive: true, force: true }); }
});
