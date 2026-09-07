import { pluginConfig, subscribePluginConfig } from 'millennium';
import { PRESENTATION_DEFAULTS, type PresentationSettings } from './presentation';

export interface Settings extends PresentationSettings {
	/**
	 * Dev: accept commands from tools/fire (devfire.ts). A name-and-args door
	 * into Steam's notification stores for anything that can write the command
	 * file in the plugin's cache directory, so it ships off.
	 */
	devFire: boolean;
	/**
	 * Shows the developer toggles in the settings panel. Deliberately has no
	 * toggle of its own: set it out-of-band (tools/mep plugin.config.set, or
	 * ~/.config/millennium/config.json while Steam is down) so normal users
	 * never see the development surface.
	 */
	devMode: boolean;
}

export const DEFAULTS: Settings = {
	...PRESENTATION_DEFAULTS,
	devFire: false,
	devMode: false,
};

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
	if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
		current = { ...current, [key]: typeof value === 'boolean' ? value : DEFAULTS[key as keyof Settings] };
	}
}

/**
 * A backend return may arrive JSON-encoded (a Lua string wrapped in literal
 * quote characters) or already decoded, depending on the transport; unwrap
 * whichever shape arrives into the object it represents.
 */
export function parseCallableJson<T>(raw: unknown, fallback: T): T {
	if (typeof raw !== 'string') return (raw as T) ?? fallback;
	try {
		const once = JSON.parse(raw);
		if (typeof once === 'string') return JSON.parse(once) as T;
		return once as T;
	} catch {
		return fallback;
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
		subscribePluginConfig((key, value) => absorb(key, value));
	}
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			const all = await pluginConfig.getAll<Record<string, unknown>>();
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
