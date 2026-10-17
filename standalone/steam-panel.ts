import { useSettingsActions } from '../shared/settings-actions';
import { sampleMessage } from '../shared/command-result';
import { visibleSettings, settingDisabled } from '../shared/settings-policy';
import { ffi, pluginConfig, subscribePluginConfig } from './adapter';
import { SETTINGS_SCHEMA, type SettingKey, type Settings } from '../shared/settings';
import { discoverSettings, discoverControls, mountSettings } from './steam-settings';

const removedMessage = 'Integration removed. Your settings are kept. Remove the Bun package separately, then restart Steam.';
type State = { config: { values: Settings; error: string | null }; state: string; compatible: boolean; hook: string };
const rpc = async (method: string, ...args: unknown[]): Promise<any> => JSON.parse(await ffi<unknown[], string>(method)(...args));
export function createSteamPanel(React: typeof import('react'), controls: ReturnType<typeof discoverControls>) {
    const h = React.createElement;
    return function Panel(): React.ReactElement {
        const [state, setState] = React.useState<State | null>(null);
        const [removed, setRemoved] = React.useState(Boolean((globalThis as any).__snnIntegrationRemoved));
        const [confirmRemove, setConfirmRemove] = React.useState(false);
        const [connected, setConnected] = React.useState(false);
        const { busy, message, error, confirmReset, setConfirmReset, refresh, run } = useSettingsActions(React);
        React.useEffect(() => {
            if (removed) return undefined;
            let polling = false;
            const read = async () => {
                if ((globalThis as any).__snnIntegrationRemoved) { setRemoved(true); return; }
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
        }, [removed]);
        const command = (method: string, ...args: unknown[]) => run(async () => {
            const result = await rpc(method, ...args);
            if (result?.ok === false) throw new Error(result.error || 'Operation unavailable');
            if (method === 'PanelRemove') (globalThis as any).__snnIntegrationRemoved = true;
            return result;
        }, result => {
            if (method === 'PanelRemove') {
                setRemoved(true); setConfirmRemove(false);
                return removedMessage;
            }
            if (method === 'PanelSample') return sampleMessage(result);
            setState(previous => previous && ({ ...previous, config: result }));
            return method === 'PanelReset' ? 'Defaults restored.' : 'Saved.';
        });
        const values = state?.config.values;
        const ready = !removed && connected && state?.state === 'ready' && state.compatible && state.hook === 'installed';
        const disabled = removed || busy || !connected || !!state?.config.error;
        const row = (key: SettingKey) => h(controls.Toggle, { key, className: `snn-setting-${key}`,
            label: SETTINGS_SCHEMA[key].label, description: SETTINGS_SCHEMA[key].description,
            checked: values?.[key] ?? false, controlled: true, disabled: disabled || !values || settingDisabled(values, key),
            onChange: (value: boolean): void => void command('PanelPatch', { [key]: value }),
        });
        return h(controls.Theme, {}, h(controls.Section, { label: 'Operating system notifications' }, h('section', { 'data-snn-panel': true },
            !removed && !ready && h('p', { role: 'status' }, !connected
                ? 'Connecting to standalone service. Controls are unavailable until connected.'
                : 'Standalone needs attention. Restart Steam if you recently updated.'),
            state?.config.error && h('p', { role: 'alert' }, state.config.error),
            ...visibleSettings(values ?? {} as Settings, 'linux').filter(key => !SETTINGS_SCHEMA[key].developer).map(row),
            values?.devMode && row('devFire'),
            h(controls.Buttons, {},
                h(controls.Button, { disabled: busy || !ready || !values?.integrationEnabled, onClick: (): void => void command('PanelSample') }, 'Send test notification'),
                h(controls.Button, { disabled, onClick: (): void => { setConfirmRemove(false); setConfirmReset(true); } }, 'Reset notification settings'),
                h(controls.Button, { disabled: removed || busy || !connected, onClick: (): void => { setConfirmReset(false); setConfirmRemove(true); } }, 'Remove OS notification integration')),
            confirmRemove && h(controls.Section, { label: 'Remove OS notification integration?' },
                h(controls.Description, {}, 'Stops the background service and removes automatic startup. Your settings are kept. Remove the Bun package separately, then restart Steam.'),
                h(controls.Buttons, {},
                    h(controls.Button, { disabled: busy || !connected, onClick: (): void => void command('PanelRemove') }, 'Remove integration'),
                    h(controls.Button, { disabled: busy, onClick: (): void => setConfirmRemove(false) }, 'Cancel'))),
            confirmReset && h(controls.Section, { label: 'Restore notification settings to their defaults?' },
                h(controls.Buttons, {},
                    h(controls.Button, { disabled, onClick: (): void => void command('PanelReset') }, 'Restore defaults'),
                    h(controls.Button, { disabled, onClick: (): void => setConfirmReset(false) }, 'Cancel'))),
            h('div', { role: error ? 'alert' : 'status' }, h(controls.Description, {}, error || (removed ? removedMessage : busy ? 'Saving…' : message))))));
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
        const attach = () => { if (instances.size) return; stop = mountSettings(React, widget, controls.Body, createSteamPanel(React, controls), report, instances); };
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
