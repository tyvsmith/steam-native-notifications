import { useSettingsActions } from '../shared/settings-actions';
import { sampleMessage } from '../shared/command-result';
import { visibleSettings, settingDisabled } from '../shared/settings-policy';
import { ffi, pluginConfig, subscribePluginConfig } from './adapter';
import { SETTINGS_SCHEMA, type SettingKey, type Settings } from '../shared/settings';
import { discoverSettings, discoverControls, mountSettings } from './steam-settings';

type State = { config: { values: Settings; error: string | null }; state: string; compatible: boolean; hook: string };
const rpc = async (method: string, ...args: unknown[]): Promise<any> => JSON.parse(await ffi<unknown[], string>(method)(...args));
function panel(React: typeof import('react'), controls: ReturnType<typeof discoverControls>) {
    const h = React.createElement;
    return function Panel(): React.ReactElement {
        const [state, setState] = React.useState<State | null>(null);
        const [connected, setConnected] = React.useState(false);
        const { busy, message, error, confirmReset, setConfirmReset, refresh, run } = useSettingsActions(React);
        React.useEffect(() => {
            let polling = false;
            const read = async () => {
                if (polling) return;
                polling = true;
                try { await refresh(() => rpc('PanelRead'), next => { setState(next); setConnected(true); }, () => setConnected(false)); }
                finally { polling = false; }
            };
            void read();
            const timer = setInterval(read, 2000);
            const unsubscribe = subscribePluginConfig(() => {
                void refresh(() => pluginConfig.getAll<Settings>(), values => setState(previous => previous && ({ ...previous, config: { ...previous.config, values } })));
            });
            return () => { clearInterval(timer); unsubscribe(); };
        }, []);
        const command = (method: string, ...args: unknown[]) => run(async () => {
            const result = await rpc(method, ...args);
            if (result?.ok === false) throw new Error(result.error || 'Operation unavailable');
            return result;
        }, result => {
            if (method === 'PanelSample') return sampleMessage(result);
            setState(previous => previous && ({ ...previous, config: result }));
            return method === 'PanelReset' ? 'Defaults restored.' : 'Saved.';
        });
        const values = state?.config.values;
        const ready = connected && state?.state === 'ready' && state.compatible && state.hook === 'installed';
        const disabled = busy || !connected || !!state?.config.error;
        const row = (key: SettingKey) => h(controls.Toggle, { key, className: `snn-setting-${key}`,
            label: SETTINGS_SCHEMA[key].label, description: SETTINGS_SCHEMA[key].description,
            checked: values?.[key] ?? false, controlled: true, disabled: disabled || !values || settingDisabled(values, key),
            onChange: (value: boolean): void => void command('PanelPatch', { [key]: value }),
        });
        return h(controls.Theme, {}, h(controls.Section, { label: 'Operating system notifications' }, h('section', { 'data-snn-panel': true },
            !ready && h('p', { role: 'status' }, !connected
                ? 'Connecting to standalone service. Controls are unavailable until connected.'
                : 'Standalone needs attention. Restart Steam if you recently updated.'),
            state?.config.error && h('p', { role: 'alert' }, state.config.error),
            ...visibleSettings(values ?? {} as Settings, 'linux').filter(key => !SETTINGS_SCHEMA[key].developer).map(row),
            values?.devMode && row('devFire'),
            h(controls.Buttons, {},
                h(controls.Button, { disabled: busy || !ready || !values?.integrationEnabled, onClick: (): void => void command('PanelSample') }, 'Send test notification'),
                h(controls.Button, { disabled, onClick: (): void => setConfirmReset(true) }, 'Reset notification settings')),
            confirmReset && h(controls.Section, { label: 'Restore notification settings to their defaults?' },
                h(controls.Buttons, {},
                    h(controls.Button, { disabled, onClick: (): void => void command('PanelReset') }, 'Restore defaults'),
                    h(controls.Button, { disabled, onClick: (): void => setConfirmReset(false) }, 'Cancel'))),
            h('div', { role: error ? 'alert' : 'status' }, h(controls.Description, {}, error || (busy ? 'Saving…' : message))))));
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
        const attach = () => { if (instances.size) return; stop = mountSettings(React, widget, controls.Body, panel(React, controls), report, instances); };
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
