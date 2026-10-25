import { expect, test } from 'bun:test';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';

async function fixture() {
    const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, 'steam-panel.ts')], target: 'browser', format: 'cjs',
        plugins: [{ name: 'host', setup(build) {
            build.onResolve({ filter: /^\.\/adapter$/ }, () => ({ path: 'host', namespace: 'fixture' }));
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: 'export const ffi = () => async () => "ok"; export const subscribeHostState = () => () => {};' }));
        } }] });
    if (!built.success) throw Error(built.logs.join('\n'));
    let required = 0, tick: (() => void) | undefined, cleared = 0;
    const requireModule: any = () => { required++; throw Error('Native module initialized'); };
    requireModule.m = {
        react: () => 'react.production.js react.forward_ref',
        settings: () => 'm_setPagedSettingsInstances renderPageContent PageListColumn',
    };
    const context: any = createContext({ crypto, module: { exports: {} },
        webpackChunksteamui: { push: (chunk: any) => chunk[2](requireModule) },
        setInterval: (callback: () => void) => { tick = callback; return 1; }, clearInterval: () => { cleared++; },
    });
    // The actual discovery seam requires Steam's chunk array shape.
    context.webpackChunksteamui = [];
    context.webpackChunksteamui.push = (chunk: any) => chunk[2](requireModule);
    runInContext(await built.outputs[0]!.text(), context);
    return { context, start: () => context.module.exports.startSteamPanel(), tick: () => tick?.(), required: () => required, cleared: () => cleared };
}

test('panel discovery waits for Steam service initialization, including partial friend stores', async () => {
    const f = await fixture(); const stop = f.start();
    expect(f.required()).toBe(0); f.tick(); expect(f.required()).toBe(0);
    f.context.friendStore = {};
    f.context.App = { GetServicesInitialized: () => false };
    f.tick(); expect(f.required()).toBe(0);
    f.context.App.GetServicesInitialized = () => true;
    f.tick(); expect(f.required()).toBe(1); expect(f.cleared()).toBe(1);
    f.tick(); expect(f.required()).toBe(1); stop();
});
test('late attachment discovers immediately after native initialization', async () => {
    const f = await fixture(); f.context.App = { GetServicesInitialized: () => true };
    f.start(); expect(f.required()).toBe(1);
});
test('stopping a pending panel prevents discovery after native readiness', async () => {
    const f = await fixture(); const stop = f.start(); stop();
    f.context.App = { GetServicesInitialized: () => true };
    f.tick(); expect(f.required()).toBe(0); expect(f.cleared()).toBe(1);
});
test('unknown native readiness stops after a bounded startup wait', async () => {
    const f = await fixture(); f.start();
    for (let i = 0; i < 240; i++) f.tick();
    expect(f.context.__snnPanelState).toBe('unavailable-restart-steam');
    expect(f.required()).toBe(0); expect(f.cleared()).toBe(1);
    f.context.App = { GetServicesInitialized: () => true }; f.tick(); expect(f.required()).toBe(0);
});
