import { setVerboseDiagnostics } from '../shared/diagnostics';
import { pluginConfig, subscribePluginConfig } from 'millennium';
import { createSettingsHost } from '../shared/host';
import { DEFAULTS, isSettingKey, type Settings } from '../shared/settings';
export { DEFAULTS } from '../shared/settings';
export type { Settings } from '../shared/settings';
export { parseCallableJson } from '../shared/host';

const store = createSettingsHost({
    getAll: () => pluginConfig.getAll(),
    set: 'set' in pluginConfig ? (key, value) => pluginConfig.set(key, value as any) : undefined,
    // Starlight binds direct SDK calls to this plugin, not function references.
    subscribe: (listener) => subscribePluginConfig(listener),
});

// Millennium can miss config pushes into the plugin's isolated world. Publish
// completed reads and writes locally so the panel and delivery use one snapshot.
let current: Settings = { ...DEFAULTS };
let revision = 0;
export const settingsHost = {
    ...store,
    async read(): Promise<Settings> {
        for (let attempt = 0; attempt < 5; attempt++) {
            const before = revision;
            const next = await store.read();
            if (revision === before) { setVerboseDiagnostics(next.verboseDiagnostics); return current = next; }
        }
        throw new Error('Settings changed during read; retry the operation');
    },
    async write(patch: Partial<Settings>) {
        const result = await store.write(patch);
        if (result.ok) { revision++; current = result.value; setVerboseDiagnostics(current.verboseDiagnostics); }
        return result;
    },
};

export function settings(): Settings {
	return current;
}

/** Keep removal and malformed-value behavior aligned with the panel defaults. */
function absorb(key: string, value: unknown): void {
	if (isSettingKey(key)) {
        revision++;
		current = { ...current, [key]: typeof value === 'boolean' ? value : DEFAULTS[key as keyof Settings] };
        setVerboseDiagnostics(current.verboseDiagnostics);
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
