import { settingDisabled, visibleSettings, preferenceDefaults, preferencePatch } from '../shared/settings-policy';
import { sampleMessage } from '../shared/command-result';
import * as React from 'react';
import { useSettingsActions } from '../shared/settings-actions';
import { DialogBodyText, DialogControlsSection, DialogControlsSectionHeader, DialogButton, ToggleField } from 'millennium';
import { DEFAULTS, settingsHost, type Settings } from './settings';
import { SETTINGS_SCHEMA, type SettingKey } from '../shared/settings';
import { loadPlatform } from './platform';
import type { Platform } from './presentation';
import { executeDevCommand } from './devfire';

const { useEffect, useState } = React;

export function SettingsPanel() {
    const [platform, setPlatform] = useState<Platform>('unknown');
    const [values, setValues] = useState<Settings>({ ...DEFAULTS });
    const [ready, setReady] = useState(false);
    const { busy, message, error, confirmReset, setConfirmReset, refresh, run } = useSettingsActions(React);
    useEffect(() => {
        let active = true;
        const read = () => refresh(() => settingsHost.read(), next => { setValues(next); setReady(true); }, () => setReady(false));
        const unsubscribe = settingsHost.subscribe(() => { void read(); });
        void read();
        void loadPlatform().then(next => { if (active) setPlatform(next); });
        return () => { active = false; unsubscribe(); };
    }, []);
    const save = async (patch: Partial<Settings>): Promise<Settings> => {
        const result = await settingsHost.write(patch);
        if (result.ok === false) throw new Error(result.message);
        return result.value;
    };
    const saved = (next: Settings) => { setValues(next); return 'Saved.'; };
    const visible = visibleSettings(values, platform);
    const row = (key: SettingKey) => <ToggleField key={key} label={SETTINGS_SCHEMA[key].label}
        description={SETTINGS_SCHEMA[key].description} checked={values[key]} disabled={!ready || busy || settingDisabled(values, key)}
        onChange={(value: boolean) => { void run(() => save(preferencePatch({ [key]: value }, values, platform)), saved); }} />;
    return <>
        <DialogControlsSection>
            <DialogControlsSectionHeader>Operating system notifications</DialogControlsSectionHeader>
            {visible.filter(key => !SETTINGS_SCHEMA[key].developer).map(row)}
        </DialogControlsSection>
        {values.devMode && <DialogControlsSection>
            <DialogControlsSectionHeader>Developer options</DialogControlsSectionHeader>
            {visible.filter(key => SETTINGS_SCHEMA[key].group === 'developer').map(row)}
        </DialogControlsSection>}
        <DialogControlsSection>
            <DialogButton disabled={!ready || busy || !values.integrationEnabled} onClick={() => { void run(() => executeDevCommand({ id: crypto.randomUUID(), createdAt: Date.now(), deadline: Date.now() + 7000, command: { call: 'TestFriendOnline', args: [] } }, true), sampleMessage); }}>Send test notification</DialogButton>
            <DialogButton disabled={!ready || busy || platform === 'unknown'} onClick={() => setConfirmReset(true)}>Reset notification settings</DialogButton>
            {confirmReset && <>
                <DialogBodyText>Restore notification settings to their defaults?</DialogBodyText>
                <DialogButton disabled={busy} onClick={() => { void run(() => save(preferenceDefaults(platform)), next => { setValues(next); return 'Defaults restored.'; }); }}>Restore defaults</DialogButton>
                <DialogButton disabled={busy} onClick={() => setConfirmReset(false)}>Cancel</DialogButton>
            </>}
            {!ready && <DialogBodyText>Settings unavailable. Reopen this page to retry.</DialogBodyText>}
            {(error || message) && <DialogBodyText>{error || message}</DialogBodyText>}
        </DialogControlsSection>
    </>;
}
