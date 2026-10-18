import { DEFAULTS, SETTINGS_SCHEMA, settingSupported, validateSettingsPatch, type Platform, type SettingKey, type Settings } from './settings';
export function visibleSettings(values: Settings, platform: Platform, schema = SETTINGS_SCHEMA): SettingKey[] {
    return (Object.keys(schema) as SettingKey[]).filter(key => {
        const field = schema[key];
        if (!field.visible || !(field.platforms as readonly string[]).includes(platform) || (field.developer && !values.devMode)) return false;
        if (key === 'notificationCenterOnlyInGame') return values.notifyInGame;
        if (key === 'notificationCenterOnlyOutsideGame') return values.notifyOutsideGame;
        return true;
    });
}
export function preferencePatch(input: unknown, current: Settings, platform: Platform): Partial<Settings> {
    const patch = validateSettingsPatch(input);
    for (const key of Object.keys(patch) as SettingKey[]) {
        if (!settingSupported(key, platform) || key === 'devMode' || (SETTINGS_SCHEMA[key].developer && key !== 'verboseDiagnostics' && !current.devMode)) throw new Error(`Setting unavailable: ${key}`);
    }
    return patch;
}
export function preferenceDefaults(platform: Platform): Partial<Settings> {
    return Object.fromEntries(Object.entries(DEFAULTS).filter(([key]) => key !== 'devMode' && settingSupported(key as SettingKey, platform)));
}

/** The master preserves preferences and leaves developer opt-in independent. */
export function settingDisabled(values: Settings, key: SettingKey): boolean {
    return !values.integrationEnabled && key !== 'integrationEnabled' && !SETTINGS_SCHEMA[key].developer;
}
