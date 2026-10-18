import { preferenceDefaults, preferencePatch } from '../shared/settings-policy';
import { sampleMessage } from '../shared/command-result';
import * as React from 'react';
import { useSettingsActions } from '../shared/settings-actions';
import { settingsContent } from '../shared/settings-content';
import { steamSettingsControls } from '../shared/steam-settings-controls';
import { DEFAULTS, settingsHost, type Settings } from './settings';
import { loadPlatform } from './platform';
import type { Platform } from './presentation';
import { executeDevCommand } from './devfire';

const { useEffect, useState } = React;

export function SettingsPanel() {
    const [platform, setPlatform] = useState<Platform>('unknown');
    const [values, setValues] = useState<Settings>({ ...DEFAULTS });
    const [ready, setReady] = useState(false);
    const { busy, message, error, refresh, run } = useSettingsActions(React);
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
    return settingsContent(React, steamSettingsControls(), {
        values, platform, disabled: !ready || busy || platform === 'unknown',
        sampleDisabled: !ready || busy || !values.integrationEnabled,
        status: !ready ? 'Settings unavailable. Reopen this page to retry.' : '',
        error, message: busy ? 'Saving…' : message,
        onPatch: patch => { void run(() => save(preferencePatch(patch, values, platform)), saved); },
        onSample: () => { void run(() => executeDevCommand({ id: crypto.randomUUID(), createdAt: Date.now(), deadline: Date.now() + 7000, command: { call: 'TestFriendOnline', args: [] } }, true), sampleMessage); },
        onReset: () => { void run(() => save(preferenceDefaults(platform)), next => { setValues(next); return 'Defaults restored.'; }); },
    });
}
