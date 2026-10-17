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
    return h(controls.Section, { label: 'Operating system notifications' }, h('section', { 'data-snn-panel': true },
        h(controls.Theme, {}, props.status && h('p', { role: 'status' }, props.status),
            ...visibleSettings(values ?? {} as Settings, props.platform).map(row)),
        h('div', { className: controls.ActionSection },
            h(controls.Button, { disabled: props.sampleDisabled, onClick: props.onSample }, 'Send test notification'),
            h(controls.Button, { disabled: props.disabled, onClick: (event: { currentTarget: HTMLElement }) => confirm(false, event) }, 'Reset notification settings'),
            props.remove && h(controls.Button, { disabled: props.remove.disabled, onClick: (event: { currentTarget: HTMLElement }) => confirm(true, event) }, 'Remove OS notification integration')),
        h('div', { role: props.error ? 'alert' : 'status' }, h(controls.Description, {}, props.error || props.message))));
}
