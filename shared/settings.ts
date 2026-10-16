export type Platform = 'windows' | 'linux' | 'macos' | 'unknown';
const all = ['windows', 'linux', 'macos', 'unknown'] as const;
const nativeDescription = 'Send a copy to your operating system. Banners follow your system notification settings.';
const steamDescription = "Keep Steam's own notification toast visible.";
const historyDescription = 'Save notifications without showing a Windows banner, even when Do Not Disturb is off.';
export const SETTINGS_SCHEMA = {
    notifyOutsideGame: { type: 'boolean', default: true, label: 'Show OS notifications', description: nativeDescription, group: 'outside', platforms: all, developer: false, visible: true },
    notifyInGame: { type: 'boolean', default: true, label: 'Show OS notifications', description: nativeDescription, group: 'inside', platforms: all, developer: false, visible: true },
    showSteamOutsideGame: { type: 'boolean', default: false, label: 'Show Steam notifications', description: steamDescription, group: 'outside', platforms: all, developer: false, visible: true },
    showSteamInGame: { type: 'boolean', default: true, label: 'Show Steam notifications', description: steamDescription, group: 'inside', platforms: all, developer: false, visible: true },
    notificationCenterOnlyOutsideGame: { type: 'boolean', default: false, label: 'Save to Notification Center only', description: historyDescription, group: 'outside', platforms: ['windows'], developer: false, visible: true },
    notificationCenterOnlyInGame: { type: 'boolean', default: false, label: 'Save to Notification Center only', description: historyDescription, group: 'inside', platforms: ['windows'], developer: false, visible: true },
    devFire: { type: 'boolean', default: false, label: 'Developer: accept test commands', description: "Allow snn dev fire and the repository tools/fire command to send synthesized notifications through Steam.", group: 'developer', platforms: all, developer: true, visible: true },
    devMode: { type: 'boolean', default: false, label: 'Show developer options', description: 'Enable developer controls explicitly.', group: 'developer', platforms: all, developer: true, visible: false },
} as const;
export type SettingKey = keyof typeof SETTINGS_SCHEMA;
export type Settings = { [K in SettingKey]: boolean };
export type PresentationSettings = Omit<Settings, 'devFire' | 'devMode'>;
export const DEFAULTS: Settings = Object.fromEntries(Object.entries(SETTINGS_SCHEMA).map(([key, field]) => [key, field.default])) as Settings;
export const PRESENTATION_DEFAULTS: PresentationSettings = {
    notifyOutsideGame: DEFAULTS.notifyOutsideGame, notifyInGame: DEFAULTS.notifyInGame,
    showSteamOutsideGame: DEFAULTS.showSteamOutsideGame, showSteamInGame: DEFAULTS.showSteamInGame,
    notificationCenterOnlyOutsideGame: DEFAULTS.notificationCenterOnlyOutsideGame,
    notificationCenterOnlyInGame: DEFAULTS.notificationCenterOnlyInGame,
};
export function isSettingKey(key: string): key is SettingKey { return Object.hasOwn(SETTINGS_SCHEMA, key); }
export function normalizeSettings(raw: unknown): Settings {
    const values = { ...DEFAULTS };
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const key of Object.keys(DEFAULTS) as SettingKey[]) {
            const value = (raw as Record<string, unknown>)[key];
            if (typeof value === 'boolean') values[key] = value;
        }
    }
    return values;
}
/** Strict writes; forgiving normalization is reserved for existing stored values. */
export function validateSettingsPatch(raw: unknown): Partial<Settings> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Settings patch must be an object');
    for (const [key, value] of Object.entries(raw)) {
        if (!isSettingKey(key) || typeof value !== 'boolean') throw new Error(`Invalid setting: ${key}`);
    }
    return { ...raw } as Partial<Settings>;
}
export function settingSupported(key: SettingKey, platform: Platform): boolean {
    return (SETTINGS_SCHEMA[key].platforms as readonly string[]).includes(platform);
}
