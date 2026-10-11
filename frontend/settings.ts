import { pluginConfig, subscribePluginConfig } from 'millennium';
import { createSettingsHost } from '../shared/host';
import { DEFAULTS, isSettingKey, type Settings } from '../shared/settings';
export { DEFAULTS } from '../shared/settings';
export type { Settings } from '../shared/settings';
export { parseCallableJson } from '../shared/host';

export const settingsHost = createSettingsHost({
    getAll: () => pluginConfig.getAll(),
    set: 'set' in pluginConfig ? (key, value) => pluginConfig.set(key, value as any) : undefined,
    subscribe: subscribePluginConfig,
});

/**
 * Read by the toast handler on every notification, so a toggle takes effect
 * immediately rather than at the next Steam start. Kept current by the
 * subscription below: settings live per-key in Millennium's own config store
 * (the panel writes them through usePluginConfig, the backend and tools/mep
 * through millennium.config), and every write is pushed here automatically.
 */
let current: Settings = { ...DEFAULTS };

export function settings(): Settings {
	return current;
}

/** Keep removal and malformed-value behavior aligned with the panel defaults. */
function absorb(key: string, value: unknown): void {
	if (isSettingKey(key)) {
		current = { ...current, [key]: typeof value === 'boolean' ? value : DEFAULTS[key as keyof Settings] };
	}
}

let subscribed = false;

/**
 * pluginConfig talks to Millennium's own config store, not this plugin's
 * backend, so the backend race the old document load retried around cannot
 * happen; the short retry covers only the first frames of a cold start.
 */
export async function loadSettings(): Promise<Settings> {
	if (!subscribed) {
		subscribed = true;
		settingsHost.subscribe((key, value) => absorb(key, value));
	}
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			const all = await settingsHost.read();
			if (all && typeof all === 'object') {
				for (const [key, value] of Object.entries(all)) absorb(key, value);
				return current;
			}
		} catch {
			/* store not up yet; retry below */
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return current;
}
