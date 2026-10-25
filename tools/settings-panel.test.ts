import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { DEFAULTS } from '../shared/settings';
async function panelFixture() {
    const sources: Record<string, string> = {
        '../shared/steam-settings-controls': 'export const steamSettingsControls = () => globalThis.controls;',
        react: 'export const createElement = (type,props,...children) => ({type,props:{...props,children:children.length === 1 ? children[0] : children}}); export const useState = globalThis.hooks.useState; export const useRef = globalThis.hooks.useRef; export const useEffect = globalThis.hooks.useEffect;',
        'react/jsx-dev-runtime': 'export const jsxDEV = (type,props) => ({type,props}); export const Fragment="fragment";',
        'react/jsx-runtime': 'export const jsx = (type,props) => ({type,props}); export const jsxs=jsx; export const Fragment="fragment";',
        millennium: 'export const DialogBodyText="text", DialogControlsSection="section", DialogControlsSectionHeader="header", DialogButton="button", ToggleField="toggle"; export const pluginConfig=globalThis.config; export const subscribePluginConfig=globalThis.subscribe;',
        './platform': 'export const loadPlatform = async () => "linux";',
        './devfire': 'export const executeDevCommand = globalThis.sample;',
    };
    const built = await Bun.build({ entrypoints: [resolve('frontend/SettingsPanel.tsx')], target: 'browser', format: 'cjs', plugins: [{ name: 'panel-fixture', setup(build) {
        build.onLoad({ filter: /frontend\/settings\.ts$/ }, async args => ({ contents: await Bun.file(args.path).text() + '\nglobalThis.runtimeSettings = settings;', loader: 'ts' }));
        build.onResolve({ filter: /^(react(?:\/jsx(?:-dev)?-runtime)?|millennium|\.\/(platform|devfire)|\.\.\/shared\/steam-settings-controls)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path]!, loader: 'js' }));
    } }] });
    if (!built.success) throw Error(built.logs.join('\n'));
    let values: any = { ...DEFAULTS, notifyOutsideGame: false, devMode: true, devFire: true, notificationCenterOnlyInGame: true };
    const slots: any[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [], listeners = new Set<Function>();
    let index = 0; const samples: any[] = []; let modal: any; const owner = {};
    const context: any = { controls: { Theme: 'theme', Section: 'section', Toggle: 'toggle', Dropdown: 'dropdown', Button: 'button', Description: 'text', ActionSection: 'native-actions', ConfirmDialog: 'confirm', ShowModal: (element: any, window: any) => { expect(window).toBe(owner); modal = element; } }, module: { exports: {} }, crypto, Date, setTimeout,
        config: { getAll: async () => ({ ...values }), set: async (key: string, value: unknown) => { values[key] = value; for (const f of listeners) f(key, value); } },
        subscribe: (fn: Function) => { listeners.add(fn); return () => listeners.delete(fn); },
        sample: async (...args: any[]) => { samples.push(args); return { stage: 'executed' }; },
        hooks: {
            useState: (initial: any) => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value: any) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
            useRef: (initial: any) => { const i = index++; return slots[i] ??= { current: initial }; },
            useEffect: (fn: () => any) => { const i = index++; if (!slots[i]) { slots[i] = true; effects.push(() => { cleanups.push(fn()); }); } },
        },
    };
    runInNewContext(await built.outputs[0]!.text(), context);
    function nodes(node: any): any[] { if (!node || typeof node !== 'object') return []; return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }
    const render = () => { index = 0; const tree = [...nodes(context.module.exports.SettingsPanel()), ...nodes(modal)]; for (const fn of effects.splice(0)) fn(); return tree; };
    const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
    const button = (label: string) => {
        if (modal && [modal.props.strOKButtonText, 'Cancel'].includes(label)) return { props: { onClick: () => { const action = label === 'Cancel' ? undefined : modal.props.onOK; modal = undefined; action?.(); } } };
        const found = render().find(n => n.type === 'button' && n.props.children === label);
        return found && { ...found, props: { ...found.props, onClick: () => found.props.onClick({ currentTarget: { ownerDocument: { defaultView: owner } } }) } };
    };
    render(); await flush();
    return { runtimeSettings: () => context.runtimeSettings(), config: context.config, render, flush, button, values: () => values, samples, close: () => cleanups.forEach(fn => fn?.()) };
}
test('Millennium panel uses shared visibility, confirms reset and preserves platform/developer opt-ins', async () => {
    const f = await panelFixture();
    try {
        expect(f.render().filter(n => n.type === 'toggle')).toHaveLength(2);
        expect(f.render().some(n => n.props.className === 'native-actions')).toBe(true);
        expect(f.button('Remove OS notification integration')).toBeUndefined();
        f.button('Reset notification settings').props.onClick();
        expect(f.render().some(n => n.type === 'confirm')).toBe(true);
        f.button('Cancel').props.onClick(); expect(f.values().notifyOutsideGame).toBe(false);
        f.button('Reset notification settings').props.onClick();
        f.button('Restore defaults').props.onClick(); await f.flush();
        expect(f.values()).toEqual({ ...DEFAULTS, devMode: true, notificationCenterOnlyInGame: true });
        expect(f.render().some(n => n.props?.children === 'Defaults restored.')).toBe(true);
        f.button('Send test notification').props.onClick(); await f.flush();
        expect(f.samples[0][1]).toBe(true); expect(f.samples[0][0].command.server.type).toBe(10);
        expect(f.samples[0][0].command.server.body.link).toBe('steam://settings/notifications');
        expect(f.render().some(n => String(n.props?.children).includes('visibility have not been confirmed'))).toBe(true);
    } finally { f.close(); }
});
test('save completion cannot overwrite a newer subscription snapshot', async () => {
    const f = await panelFixture();
    try {
        const getAll = f.config.getAll; let calls = 0; let release!: () => void;
        f.config.getAll = async () => {
            const snapshot = await getAll();
            if (++calls === 1) await new Promise<void>(resolve => { release = resolve; });
            return snapshot;
        };
        // Subscription reads queue during the write; hold its completion snapshot.
        f.render().find(n => n.type === 'dropdown' && n.props.label === 'On desktop').props.onChange({ data: 2 });
        await f.flush(); expect(typeof release).toBe('function');
        await f.config.set('notifyOutsideGame', false); await f.flush();
        release(); await f.flush();
        expect(f.values().notifyOutsideGame).toBe(false);
        expect(f.render().find(n => n.type === 'dropdown' && n.props.label === 'On desktop').props.selectedOption).toBe(0);
    } finally { f.close(); }
});

test('master disables dependent controls and sample while retaining preferences and developer opt-in', async () => {
    const f = await panelFixture();
    try {
        const before = { ...f.values() };
        const master = () => f.render().find(n => n.type === 'toggle' && n.props.label === 'Enable Steam Native Notifications');
        master().props.onChange(false); await f.flush();
        expect(f.values()).toEqual({ ...before, integrationEnabled: false });
        expect(master().props.disabled).toBe(false);
        expect(f.render().filter(n => n.type === 'dropdown').every(n => n.props.disabled)).toBe(true);
        expect(f.render().filter(n => n.type === 'toggle').at(-1).props.disabled).toBe(false);
        expect(f.button('Send test notification').props.disabled).toBe(true);
        master().props.onChange(true); await f.flush();
        expect(f.values()).toEqual(before);
        expect(f.button('Send test notification').props.disabled).toBe(false);
    } finally { f.close(); }
});

test('panel writes update delivery settings when Millennium sends no subscription event', async () => {
    const f = await panelFixture();
    try {
        f.config.set = async (key: string, value: unknown) => { f.values()[key] = value; };
        const row = () => f.render().find(n => n.type === 'dropdown' && n.props.label === 'On desktop');
        row().props.onChange({ data: 1 }); await f.flush();
        expect(f.runtimeSettings().showSteamOutsideGame).toBe(true);
        row().props.onChange({ data: 3 }); await f.flush();
        expect(f.runtimeSettings().notifyOutsideGame).toBe(true);
        row().props.onChange({ data: 0 }); await f.flush();
        expect(f.runtimeSettings()).toMatchObject({ notifyOutsideGame: false, showSteamOutsideGame: false });
        f.render().find(n => n.type === 'toggle' && n.props.label === 'Enable Steam Native Notifications').props.onChange(false); await f.flush();
        expect(f.runtimeSettings().integrationEnabled).toBe(false);
    } finally { f.close(); }
});

test('delivery dropdowns preserve all four routing combinations in both contexts', async () => {
    const f = await panelFixture();
    try {
        for (const [label, native, steam] of [['In game', 'notifyInGame', 'showSteamInGame'], ['On desktop', 'notifyOutsideGame', 'showSteamOutsideGame']]) {
            for (const data of [0, 1, 2, 3]) {
                const row = () => f.render().find(n => n.type === 'dropdown' && n.props.label === label);
                row().props.onChange({ data }); await f.flush();
                expect(f.values()[native!]).toBe(!!(data & 2));
                expect(f.values()[steam!]).toBe(!!(data & 1));
                expect(row().props.selectedOption).toBe(data);
            }
        }
    } finally { f.close(); }
});
