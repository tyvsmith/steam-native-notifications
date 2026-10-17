import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { DEFAULTS } from '../shared/settings';

async function fixture() {
    const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, 'steam-panel.ts')], target: 'browser', format: 'cjs', plugins: [{ name: 'panel', setup(build) {
        build.onResolve({ filter: /^\.\/adapter$/ }, () => ({ path: 'adapter', namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const ffi = method => (...args) => globalThis.fixtureRPC(method, args); export const pluginConfig = { getAll: async () => ({}) }; export const subscribePluginConfig = () => () => {};', loader: 'js' }));
    } }] });
    if (!built.success) throw Error(built.logs.join('\n'));
    const slots: any[] = [], effects: Function[] = [], cleanups: Function[] = [], calls: string[] = [];
    let poll: (() => Promise<void>) | undefined;
    let index = 0, failure = false, hold: (() => Promise<void>) | undefined;
    const hooks = {
        createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
        useState: (initial: any) => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value: any) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
        useRef: (initial: any) => { const i = index++; return slots[i] ??= { current: initial }; },
        useEffect: (fn: Function) => { const i = index++; if (!slots[i]) { slots[i] = true; effects.push(fn); } },
    };
    const context: any = { Error, module: { exports: {} }, setInterval: (fn: () => Promise<void>) => { poll = fn; return 0; }, clearInterval() {}, fixtureRPC: async (method: string) => {
        calls.push(method);
        if (method === 'PanelRemove') { await hold?.(); if (failure) throw Error('Cleanup refused'); context.__snnIntegrationRemoved = true; return '{"ok":true}'; }
        return JSON.stringify({ config: { values: DEFAULTS, error: null }, state: 'ready', compatible: true, hook: 'installed' });
    } };
    runInNewContext(await built.outputs[0]!.text(), context);
    let modal: any;
    const owner = {};
    const Panel = context.module.exports.createSteamPanel(hooks, { Theme: 'theme', Section: 'section', Toggle: 'toggle', Button: 'button', Buttons: 'buttons', Description: 'description', ConfirmDialog: 'confirm', ShowModal: (element: any, window: any) => { expect(window).toBe(owner); modal = element; } });
    const nodes = (node: any): any[] => {
        if (!node || typeof node !== 'object' || (node.type === 'modal' && !node.props.active)) return [];
        const buttons = node.type === 'confirm' ? [
            { type: 'button', props: { children: [node.props.strOKButtonText], onClick: () => { node.props.onOK(); modal = undefined; }, disabled: false } },
            { type: 'button', props: { children: ['Cancel'], onClick: () => { modal = undefined; }, disabled: false } },
        ] : [];
        return [node, ...buttons, ...node.props.children.flat(Infinity).flatMap(nodes)];
    };
    const render = () => { index = 0; const tree = [...nodes(Panel()), ...nodes(modal)]; effects.splice(0).forEach(fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); }); return tree; };
    const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
    const button = (label: string) => { const found = render().find(n => n.type === 'button' && n.props.children[0] === label); if (!found) return undefined; return { ...found, props: { ...found.props, onClick: () => found.props.onClick({ currentTarget: { ownerDocument: { defaultView: owner } } }) } }; };
    render(); await flush();
    return { calls, render, flush, button, poll: async () => { await poll?.(); }, close: () => { cleanups.splice(0).forEach(fn => fn()); slots.length = 0; }, fail: () => { failure = true; }, hold: (fn: () => Promise<void>) => { hold = fn; } };
}
test('removal requires confirmation, cancellation does nothing and success disables controls', async () => {
    const f = await fixture();
    f.button('Remove OS notification integration').props.onClick();
    f.button('Cancel').props.onClick(); expect(f.calls).not.toContain('PanelRemove');
    f.button('Remove OS notification integration').props.onClick();
    let release!: () => void; f.hold(() => new Promise<void>(resolve => { release = resolve; }));
    const submit = f.button('Remove integration');
    submit.props.onClick();
    submit.props.onClick();
    expect(f.calls.filter(x => x === 'PanelRemove')).toHaveLength(1);
    expect(f.button('Remove integration')).toBeUndefined();
    expect(f.button('Remove OS notification integration').props.disabled).toBe(true);
    release(); await f.flush();
    expect(f.render().filter(n => n.type === 'toggle').every(n => n.props.disabled)).toBe(true);
    expect(f.button('Send test notification').props.disabled).toBe(true);
    expect(f.button('Remove OS notification integration').props.disabled).toBe(true);
    expect(f.render().some(n => n.props.children.includes('Integration removed. Restart Steam to finish unloading it.'))).toBe(true);
});
test('failed removal reports error and permits retry without disabling settings', async () => {
    const f = await fixture(); f.fail();
    f.button('Remove OS notification integration').props.onClick();
    f.button('Remove integration').props.onClick(); await f.flush();
    expect(f.render().some(n => n.props.children.includes('Cleanup refused'))).toBe(true);
    f.button('Remove OS notification integration').props.onClick();
    expect(f.button('Remove integration')).toBeDefined();
    expect(f.button('Send test notification').props.disabled).toBe(false);
});

test('closing settings during removal retains the removed state on reopening', async () => {
    const f = await fixture();
    let release!: () => void; f.hold(() => new Promise<void>(resolve => { release = resolve; }));
    f.button('Remove OS notification integration').props.onClick();
    f.button('Remove integration').props.onClick();
    f.close(); release(); await f.flush();
    expect(f.button('Remove OS notification integration').props.disabled).toBe(true);
    expect(f.render().some(n => n.props.children.includes('Integration removed. Restart Steam to finish unloading it.'))).toBe(true);
});

test('reopening settings before removal completes observes completion from the old panel', async () => {
    const f = await fixture();
    let release!: () => void; f.hold(() => new Promise<void>(resolve => { release = resolve; }));
    f.button('Remove OS notification integration').props.onClick();
    f.button('Remove integration').props.onClick();
    f.close(); f.render(); await f.flush();
    release(); await f.flush(); await f.poll();
    expect(f.button('Remove OS notification integration').props.disabled).toBe(true);
    expect(f.render().some(n => n.props.children.includes('Integration removed. Restart Steam to finish unloading it.'))).toBe(true);
});

test('reset uses a native modal and cancellation preserves preferences', async () => {
    const f = await fixture();
    f.button('Reset notification settings').props.onClick();
    expect(f.render().find(n => n.type === 'confirm').props.strTitle).toBe('Reset notification settings?');
    f.button('Cancel').props.onClick();
    expect(f.calls).not.toContain('PanelReset');
    expect(f.render().some(n => n.type === 'confirm')).toBe(false);
    f.button('Reset notification settings').props.onClick();
    f.button('Restore defaults').props.onClick(); await f.flush();
    expect(f.calls.filter(x => x === 'PanelReset')).toHaveLength(1);
    expect(f.render().some(n => n.type === 'confirm')).toBe(false);
});
