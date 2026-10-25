import type * as React from 'react';
import type { discoverControls } from './steam-settings-controls';
import { SETTINGS_SCHEMA, type SettingKey, type Settings, type Platform } from './settings';
import { visibleSettings, settingDisabled } from './settings-policy';

type Controls = ReturnType<typeof discoverControls>;
interface Props {
    values: Settings | null; platform: Platform; disabled: boolean; sampleDisabled: boolean;
    status?: string; error?: string; message?: string;
    onPatch(patch: Partial<Settings>): void; onSample(): void; onReset(): void;
    remove?: { disabled: boolean; onConfirm(): void };
}
/** One native view; each host supplies persistence, readiness and optional removal. */
export function settingsContent(React: typeof import('react'), controls: Controls, props: Props): React.ReactElement {
    const h = React.createElement;
    const { values } = props;
    const confirm = (remove: boolean, event: { currentTarget: HTMLElement }) => {
        const owner = event.currentTarget.ownerDocument.defaultView;
        if (!owner) return;
        controls.ShowModal(h(controls.ConfirmDialog, {
            strTitle: remove ? 'Remove OS notification integration?' : 'Reset notification settings?',
            strDescription: remove ? 'Stops OS notifications and automatic startup. Your settings are kept.' : 'Restores this integration’s notification preferences to their defaults. Steam’s own settings are kept.',
            strOKButtonText: remove ? 'Remove integration' : 'Restore defaults', strCancelButtonText: 'Cancel',
            onOK: remove ? props.remove?.onConfirm : props.onReset,
        }), owner);
    };
    const row = (key: SettingKey) => h(controls.Toggle, { key, className: `snn-setting-${key}`,
        label: SETTINGS_SCHEMA[key].label, description: SETTINGS_SCHEMA[key].description,
        checked: values?.[key] ?? false, controlled: true,
        disabled: props.disabled || !values || settingDisabled(values, key),
        onChange: (value: boolean) => props.onPatch({ [key]: value }),
    });
    const deliveryKeys = ['notifyInGame', 'showSteamInGame', 'notifyOutsideGame', 'showSteamOutsideGame'];
    const delivery = (inside: boolean) => {
        const native = inside ? 'notifyInGame' : 'notifyOutsideGame';
        const steam = inside ? 'showSteamInGame' : 'showSteamOutsideGame';
        return h(controls.Dropdown, {
            key: native, strClassName: 'snn-delivery-row', label: inside ? 'In game' : 'On desktop',
            layout: 'inline', inlineWrap: true, childrenContainerWidth: 'max', controlled: true,
            selectedOption: (values?.[native] ? 2 : 0) + (values?.[steam] ? 1 : 0),
            rgOptions: [{ data: 1, label: 'Steam only' }, { data: 2, label: 'System only' },
                { data: 3, label: 'Steam + System' }, { data: 0, label: 'Off' }],
            disabled: props.disabled || !values || !values.integrationEnabled,
            onChange: ({ data }: { data: number }) => {
                if (Number.isInteger(data) && data >= 0 && data <= 3)
                    props.onPatch({ [native]: !!(data & 2), [steam]: !!(data & 1) });
            },
        });
    };
    return h(controls.Section, { label: 'Steam Native Notifications' }, h('section', { 'data-snn-panel': true, style: { containerType: 'inline-size', containerName: 'snn-settings' } },
        h('style', {}, `[data-snn-panel] .snn-delivery-row > div:first-child { flex: 0 1 auto; width: calc(100% - 232px); }
        [data-snn-panel] .snn-delivery-row > div:last-child { flex: 0 0 220px; }
        [data-snn-panel] .snn-delivery-row button { width: 100%; }
        @container snn-settings (max-width: 480px) {
            [data-snn-panel] .snn-delivery-row { flex-direction: column; align-items: stretch; gap: 12px; }
            [data-snn-panel] .snn-delivery-row > div:first-child,
            [data-snn-panel] .snn-delivery-row > div:last-child { flex: none; width: 100%; margin: 0; }
        }`),
        h(controls.Theme, {}, props.status && h('p', { role: 'status' }, props.status),
            row('integrationEnabled'),
            h(controls.Description, {}, 'Choose where Steam notifications are sent.'),
            delivery(true), delivery(false),
            h(controls.Description, {}, 'System notifications use your operating system’s notification service, including Do Not Disturb and notification history where supported.'),
            ...visibleSettings(values ?? {} as Settings, props.platform).filter(key => key !== 'integrationEnabled' && !deliveryKeys.includes(key)).map(row)),
        h(controls.Description, {}, 'The test uses Steam’s friend-online toast. Enable “When a friend comes online → Show toast” in Steam Settings → Notifications. System delivery also follows your OS notification settings.'),
        h('div', { className: controls.ActionSection },
            h(controls.Button, { disabled: props.sampleDisabled, onClick: props.onSample }, 'Send test notification'),
            h(controls.Button, { disabled: props.disabled, onClick: (event: { currentTarget: HTMLElement }) => confirm(false, event) }, 'Reset notification settings'),
            props.remove && h(controls.Button, { disabled: props.remove.disabled, onClick: (event: { currentTarget: HTMLElement }) => confirm(true, event) }, 'Remove OS notification integration')),
        h('div', { role: props.error ? 'alert' : 'status' }, h(controls.Description, {}, props.error || props.message))));
}
