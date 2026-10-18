import { test, expect } from 'bun:test';
import { DEFAULTS } from './settings';
import { visibleSettings, preferenceDefaults, settingDisabled } from './settings-policy';
test('visible controls honor platform, opt-in and parent OS toggle', () => {
    expect(visibleSettings(DEFAULTS, 'linux')).not.toContain('notificationCenterOnlyInGame');
    expect(visibleSettings(DEFAULTS, 'windows')).toContain('notificationCenterOnlyInGame');
    expect(visibleSettings({ ...DEFAULTS, notifyInGame: false }, 'windows')).not.toContain('notificationCenterOnlyInGame');
    expect(visibleSettings(DEFAULTS, 'unknown')).not.toContain('notificationCenterOnlyInGame');
    expect(visibleSettings(DEFAULTS, 'linux')).not.toContain('devFire');
    expect(visibleSettings({ ...DEFAULTS, devMode: true }, 'linux')).toContain('devFire');
});
test('reset changes supported preferences and preserves developer opt-in/unsupported keys', () => {
    expect(preferenceDefaults('linux')).not.toHaveProperty('devMode');
    expect(preferenceDefaults('linux')).not.toHaveProperty('notificationCenterOnlyInGame');
    expect(preferenceDefaults('linux').devFire).toBe(false);
});

test('flat presentation controls retain order and disable without changing saved values', () => {
    const values = { ...DEFAULTS, integrationEnabled: false, devMode: true, devFire: true };
    expect(visibleSettings(values, 'linux')).toEqual(['integrationEnabled', 'notifyInGame', 'showSteamInGame', 'notifyOutsideGame', 'showSteamOutsideGame', 'devFire']);
    expect(visibleSettings(values, 'linux').map(key => settingDisabled(values, key))).toEqual([false, true, true, true, true, false]);
    expect(values).toEqual({ ...DEFAULTS, integrationEnabled: false, devMode: true, devFire: true });
});
