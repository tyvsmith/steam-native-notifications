import { preferencePatch, preferenceDefaults } from '../shared/settings-policy';
import type { Settings } from '../shared/settings';
export const panelPatch = (input: unknown, current: Settings) => preferencePatch(input, current, 'linux');
export const panelDefaults = () => preferenceDefaults('linux');
