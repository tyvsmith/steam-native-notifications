import { test, expect } from 'bun:test';
import { DEFAULTS } from './settings';
import { visibleSettings, preferenceDefaults, settingsWarning, SETTINGS_CONTEXT } from './settings-policy';
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
    expect(settingsWarning({ ...DEFAULTS, notifyOutsideGame: false }, 'outside')).toContain('off');
    expect(SETTINGS_CONTEXT.inside.description).toContain('alt-tabbing');
});
