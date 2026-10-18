import { useSettingsActions } from '../shared/settings-actions';
import { sampleMessage } from '../shared/command-result';
import { settingsContent } from '../shared/settings-content';
import { ffi, subscribeHostState, type PanelState } from './adapter';
import { discoverSettings, discoverControls, mountSettings } from './steam-settings';

const removedMessage = 'Integration removed. Restart Steam to finish unloading it.';
type State = PanelState;
const rpc = async (method: string, ...args: unknown[]): Promise<any> => JSON.parse(await ffi<unknown[], string>(method)(...args));
export function createSteamPanel(React: typeof import('react'), controls: ReturnType<typeof discoverControls>) {
    return function Panel(): React.ReactElement {
        const [state, setState] = React.useState<State | null>(null);
        const [removed, setRemoved] = React.useState(Boolean((globalThis as any).__snnIntegrationRemoved));
        const [connected, setConnected] = React.useState(false);
        const { busy, message, error, refresh, run } = useSettingsActions(React);
        React.useEffect(() => {
            if (removed) return undefined;
            let active = true;
            const apply = (next: State) => {
                if (!active) return;
                if (next.removed || (globalThis as any).__snnIntegrationRemoved) { setRemoved(true); return; }
                setState(next); setConnected(true);
            };
            let pushed = false;
            const unsubscribe = subscribeHostState(next => { pushed = true; apply(next); });
            pushed = false; // Cached state does not supersede this mount's fresh health read.
            void refresh(() => rpc('PanelRead'), next => { if (!pushed) apply(next); }, () => { if (active) setConnected(false); });
            return () => { active = false; unsubscribe(); };
        }, [removed]);
        const command = (method: string, ...args: unknown[]) => run(async () => {
            const result = await rpc(method, ...args).catch((reason: Error) => {
                if (reason.message.endsWith('host timeout')) setConnected(false);
                throw reason;
            });
            if (result?.ok === false) throw new Error(result.error || 'Operation unavailable');
            return result;
        }, result => {
            if (method === 'PanelRemove') {
                setRemoved(true);
                return removedMessage;
            }
            if (method === 'PanelSample') return sampleMessage(result);
            return method === 'PanelReset' ? 'Defaults restored.' : 'Saved.';
        });
        const values = state?.config.values;
        const ready = !removed && connected && state?.state === 'ready' && state.compatible && state.hook === 'installed';
        const disabled = removed || busy || !connected || !!state?.config.error;
        return settingsContent(React, controls, {
            values: values ?? null, platform: 'linux', disabled,
            sampleDisabled: busy || !ready || !values?.integrationEnabled,
            status: !removed && !ready ? (!connected
                ? 'Connecting to standalone service. Controls are unavailable until connected.'
                : 'Standalone needs attention. Restart Steam if you recently updated.') : '',
            error: error || state?.config.error,
            message: removed ? removedMessage : busy ? 'Saving…' : message,
            onPatch: patch => { void command('PanelPatch', patch); },
            onSample: () => { void command('PanelSample'); },
            onReset: () => { void command('PanelReset'); },
            remove: { disabled: removed || busy || !connected, onConfirm: () => { void command('PanelRemove'); } },
        });
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
        let attempts = 0;
        const timer = setInterval(() => {
            try { attach(); if (stop || ++attempts >= 60) { clearInterval(timer); if (!stop) report('unavailable-restart-steam'); } }
            catch { clearInterval(timer); report('unavailable'); }
        }, 500);
        return () => { clearInterval(timer); stop?.(); };
    } catch { report('unavailable'); return () => {}; }
}
