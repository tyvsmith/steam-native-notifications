import { settingDisabled, visibleSettings, preferenceDefaults, preferencePatch } from '../shared/settings-policy';
import { sampleMessage } from '../shared/command-result';
import { useEffect, useRef, useState } from 'react';
import { DialogBodyText, DialogControlsSection, DialogControlsSectionHeader, DialogButton, ToggleField } from 'millennium';
import { DEFAULTS, settingsHost, type Settings } from './settings';
import { SETTINGS_SCHEMA, type SettingKey } from '../shared/settings';
import { loadPlatform } from './platform';
import type { Platform } from './presentation';
import { executeDevCommand } from './devfire';

export function SettingsPanel() {
    const [platform, setPlatform] = useState<Platform>('unknown');
    const [values, setValues] = useState<Settings>({ ...DEFAULTS });
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [confirmReset, setConfirmReset] = useState(false);
    const active = useRef(false);
    const operation = useRef(false);
    const generation = useRef(0);
    useEffect(() => {
        active.current = true;
        const refresh = async () => {
            const current = ++generation.current;
            try {
                const next = await settingsHost.read();
                if (active.current && current === generation.current) { setValues(next); setReady(true); }
            } catch { if (active.current && current === generation.current) { setReady(false); setMessage('Settings unavailable. Reopen this page to retry.'); } }
        };
        const unsubscribe = settingsHost.subscribe(() => { void refresh(); });
        void refresh();
        void loadPlatform().then(next => { if (active.current) setPlatform(next); });
        return () => { active.current = false; generation.current++; unsubscribe(); };
    }, []);
    const run = async (action: () => Promise<string>) => {
        if (operation.current) return;
        operation.current = true; setBusy(true); setMessage('');
        try { const text = await action(); if (active.current) { setMessage(text); setConfirmReset(false); } }
        catch (error) { if (active.current) setMessage(error instanceof Error ? error.message : 'Operation failed'); }
        finally { operation.current = false; if (active.current) setBusy(false); }
    };
    const save = async (patch: Partial<Settings>): Promise<string> => {
        const current = ++generation.current;
        const result = await settingsHost.write(patch);
        if (result.ok === false) throw new Error(result.message);
        if (active.current && current === generation.current) setValues(result.value);
        return 'Saved. Changes apply without restarting Steam.';
    };
    const visible = visibleSettings(values, platform);
    const row = (key: SettingKey) => <ToggleField key={key} label={SETTINGS_SCHEMA[key].label}
        description={SETTINGS_SCHEMA[key].description} checked={values[key]} disabled={!ready || busy || settingDisabled(values, key)}
        onChange={(value: boolean) => { void run(() => save(preferencePatch({ [key]: value }, values, platform))); }} />;
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
            <DialogButton disabled={!ready || busy || !values.integrationEnabled} onClick={() => { void run(async () => sampleMessage(await executeDevCommand({ id: crypto.randomUUID(), createdAt: Date.now(), deadline: Date.now() + 7000, command: { call: 'TestFriendOnline', args: [] } }, true))); }}>Send test notification</DialogButton>
            <DialogButton disabled={!ready || busy || platform === 'unknown'} onClick={() => setConfirmReset(true)}>Reset notification settings</DialogButton>
            {confirmReset && <>
                <DialogBodyText>Restore notification settings to their defaults?</DialogBodyText>
                <DialogButton disabled={busy} onClick={() => { void run(async () => { await save(preferenceDefaults(platform)); return 'Defaults restored.'; }); }}>Restore defaults</DialogButton>
                <DialogButton disabled={busy} onClick={() => setConfirmReset(false)}>Cancel</DialogButton>
            </>}
            {message && <DialogBodyText>{message}</DialogBodyText>}
        </DialogControlsSection>
    </>;
}
