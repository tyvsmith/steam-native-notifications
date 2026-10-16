import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { DEFAULTS } from '../shared/settings';
async function panelFixture() {
    const sources: Record<string, string> = {
        react: 'export const useState = globalThis.hooks.useState; export const useRef = globalThis.hooks.useRef; export const useEffect = globalThis.hooks.useEffect;',
        'react/jsx-dev-runtime': 'export const jsxDEV = (type,props) => ({type,props}); export const Fragment="fragment";',
        'react/jsx-runtime': 'export const jsx = (type,props) => ({type,props}); export const jsxs=jsx; export const Fragment="fragment";',
        millennium: 'export const DialogBodyText="text", DialogControlsSection="section", DialogControlsSectionHeader="header", DialogButton="button", ToggleField="toggle"; export const pluginConfig=globalThis.config; export const subscribePluginConfig=globalThis.subscribe;',
        './platform': 'export const loadPlatform = async () => "linux";',
        './devfire': 'export const executeDevCommand = globalThis.sample;',
    };
    const built = await Bun.build({ entrypoints: [resolve('frontend/SettingsPanel.tsx')], target: 'browser', format: 'cjs', plugins: [{ name: 'panel-fixture', setup(build) {
        build.onResolve({ filter: /^(react(?:\/jsx(?:-dev)?-runtime)?|millennium|\.\/(platform|devfire))$/ }, args => ({ path: args.path, namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path]!, loader: 'js' }));
    } }] });
    if (!built.success) throw Error(built.logs.join('\n'));
    let values: any = { ...DEFAULTS, notifyOutsideGame: false, devMode: true, devFire: true, notificationCenterOnlyInGame: true };
    const slots: any[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [], listeners = new Set<Function>();
    let index = 0; const samples: any[] = [];
    const context: any = { module: { exports: {} }, crypto, Date, setTimeout,
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
    const render = () => { index = 0; const tree = nodes(context.module.exports.SettingsPanel()); for (const fn of effects.splice(0)) fn(); return tree; };
    const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
    const button = (label: string) => render().find(n => n.type === 'button' && n.props.children === label);
    render(); await flush();
    return { config: context.config, render, flush, button, values: () => values, samples, close: () => cleanups.forEach(fn => fn?.()) };
}
test('Millennium panel uses shared visibility, confirms reset and preserves platform/developer opt-ins', async () => {
    const f = await panelFixture();
    try {
        expect(f.render().filter(n => n.type === 'toggle')).toHaveLength(5);
        f.button('Reset to defaults').props.onClick();
        f.button('Cancel').props.onClick(); expect(f.values().notifyOutsideGame).toBe(false);
        f.button('Reset to defaults').props.onClick();
        f.button('Restore defaults').props.onClick(); await f.flush();
        expect(f.values()).toEqual({ ...DEFAULTS, devMode: true, notificationCenterOnlyInGame: true });
        expect(f.render().some(n => n.props?.children === 'Defaults restored.')).toBe(true);
        f.button('Send sample notification').props.onClick(); await f.flush();
        expect(f.samples[0][1]).toBe(true); expect(f.samples[0][0].command.call).toBe('TestFriendOnline');
        expect(f.render().some(n => String(n.props?.children).includes('visibility have not been confirmed'))).toBe(true);
    } finally { f.close(); }
});
test('save completion cannot overwrite a newer subscription snapshot', async () => {
    const f = await panelFixture();
    try {
        const getAll = f.config.getAll; let calls = 0; let release!: () => void;
        f.config.getAll = async () => {
            const snapshot = await getAll();
            if (++calls === 2) await new Promise<void>(resolve => { release = resolve; });
            return snapshot;
        };
        // The first snapshot is the write's subscription; the second is its completion read.
        f.render().find(n => n.type === 'toggle').props.onChange(true);
        await f.flush(); expect(typeof release).toBe('function');
        await f.config.set('notifyOutsideGame', false); await f.flush();
        release(); await f.flush();
        expect(f.values().notifyOutsideGame).toBe(false);
        expect(f.render().find(n => n.type === 'toggle').props.checked).toBe(false);
    } finally { f.close(); }
});
