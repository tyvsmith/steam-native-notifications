import { sampleMessage } from '../shared/command-result';
import { visibleSettings, settingsWarning, SETTINGS_CONTEXT } from '../shared/settings-policy';
import { ffi, pluginConfig, subscribePluginConfig } from './adapter';
import { SETTINGS_SCHEMA, type SettingKey, type Settings } from '../shared/settings';
import { discoverSettings, discoverControls, mountSettings } from './steam-settings';

type State = { config: { values: Settings; error: string | null }; state: string; compatible: boolean; hook: string };
const rpc = async (method: string, ...args: unknown[]): Promise<any> => JSON.parse(await ffi<unknown[], string>(method)(...args));
function panel(React: typeof import('react'), controls: ReturnType<typeof discoverControls>) {
    const h = React.createElement;
    return function Panel(): React.ReactElement {
        const [state, setState] = React.useState<State | null>(null);
        const [error, setError] = React.useState('');
        const [message, setMessage] = React.useState('');
        const [busy, setBusy] = React.useState(false);
        const [connected, setConnected] = React.useState(false);
        const [confirmReset, setConfirmReset] = React.useState(false);
        const active = React.useRef(true);
        const operation = React.useRef(false);
        const generation = React.useRef(0);
        React.useEffect(() => {
            active.current = true;
            let polling = false;
            const refresh = async () => {
                if (polling || operation.current) return;
                polling = true; const current = ++generation.current;
                try { const next = await rpc('PanelRead'); if (active.current && !operation.current && current === generation.current) { setState(next); setConnected(true); } }
                catch { if (active.current && current === generation.current) setConnected(false); }
                finally { polling = false; }
            };
            void refresh();
            const timer = setInterval(refresh, 2000);
            const unsubscribe = subscribePluginConfig(() => {
                const current = ++generation.current;
                void pluginConfig.getAll<Settings>().then(values => { if (active.current && !operation.current && current === generation.current) setState(previous => previous && ({ ...previous, config: { ...previous.config, values } })); });
            });
            return () => { active.current = false; clearInterval(timer); unsubscribe(); };
        }, []);
        const run = async (method: string, ...args: unknown[]): Promise<void> => {
            if (operation.current) return;
            operation.current = true; generation.current++; setBusy(true); setError(''); setMessage('');
            try {
                const result = await rpc(method, ...args);
                if (!active.current) return;
                if (method === 'PanelSample') {
                    if (result?.ok === false) throw new Error(result.error || 'Sample unavailable');
                    setMessage(sampleMessage(result));
                } else { setState(previous => previous && ({ ...previous, config: result })); setMessage(method === 'PanelReset' ? 'Defaults restored.' : 'Saved.'); }
                setConfirmReset(false);
            } catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Operation failed'); }
            finally { operation.current = false; if (active.current) setBusy(false); }
        };
        const values = state?.config.values;
        const ready = connected && state?.state === 'ready' && state.compatible && state.hook === 'installed';
        const disabled = busy || !connected || !!state?.config.error;
        const row = (key: SettingKey) => h(controls.Toggle, { key, className: `snn-setting-${key}`,
            label: SETTINGS_SCHEMA[key].label, description: SETTINGS_SCHEMA[key].description,
            checked: values?.[key] ?? false, controlled: true, disabled,
            onChange: (value: boolean): void => void run('PanelPatch', { [key]: value }),
        });
        return h(controls.Theme, {}, h('section', { 'data-snn-panel': true },
            h(controls.Description, {}, 'Mirror Steam notifications to your desktop, with artwork and click actions.'),
            !ready && h('p', { role: 'status' }, !connected
                ? 'Connecting to standalone service. Controls are unavailable until connected.'
                : 'Standalone needs attention. Restart Steam if you recently updated.'),
            state?.config.error && h('p', { role: 'alert' }, state.config.error),
            ...(['outside', 'inside'] as const).map(group => h(controls.Section, { key: group, label: SETTINGS_CONTEXT[group].title },
                h(controls.Description, {}, SETTINGS_CONTEXT[group].description),
                ...visibleSettings(values ?? {} as Settings, 'linux').filter(key => SETTINGS_SCHEMA[key].group === group).map(row),
                values && settingsWarning(values, group) && h(controls.Description, {}, settingsWarning(values, group)))),
            values?.devMode && row('devFire'),
            h(controls.Buttons, {},
                h(controls.Button, { disabled: busy || !ready, onClick: (): void => void run('PanelSample') }, 'Send sample notification'),
                h(controls.Button, { disabled, onClick: (): void => setConfirmReset(true) }, 'Reset to defaults')),
            confirmReset && h(controls.Section, { label: 'Restore notification settings to their defaults?' },
                h(controls.Buttons, {},
                    h(controls.Button, { disabled, onClick: (): void => void run('PanelReset') }, 'Restore defaults'),
                    h(controls.Button, { onClick: (): void => setConfirmReset(false) }, 'Cancel'))),
            h('div', { role: error ? 'alert' : 'status' }, h(controls.Description, {}, error || (busy ? 'Saving…' : message)))));
    };
}
export function startSteamPanel(): () => void {
    const root = globalThis as any;
    const report = (state: string) => { root.__snnPanelState = state; void ffi<[string], string>('Log')(`settings-panel: ${state}`).catch(() => {}); };
    try {
        let requireModule: any;
        const chunks = root.webpackChunksteamui;
        if (!Array.isArray(chunks)) throw new Error('Steam loader unavailable');
        chunks.push([[`snn-settings-${crypto.randomUUID()}`], {}, (value: any) => { requireModule = value; }]);
        const { React, widget, instances } = discoverSettings(requireModule);
        const controls = discoverControls(requireModule);
        let stop: (() => void) | undefined;
        const attach = () => { if (instances.size) return; stop = mountSettings(React, widget, panel(React, controls), report, instances, controls.DividerClass); };
        attach();
        if (stop) return stop;
        report('waiting-for-settings-close');
        const timer = setInterval(() => {
            try { attach(); if (stop) clearInterval(timer); }
            catch { clearInterval(timer); report('unavailable'); }
        }, 500);
        return () => { clearInterval(timer); stop?.(); };
    } catch { report('unavailable'); return () => {}; }
}
