import { hostMethod } from './host';
import { sampleCommand, validateDevCommand, type DevEnvelope } from '../shared/dev-command';
import { findModuleExport } from 'millennium';
import { dlog, safeJson } from './log';
import { settings } from './settings';
import { inspectReplayStash, invokeReplayHandler } from './replay';
import { currentClickSurface } from './overlay';

function normalizeHostFocus(raw: string): 'game' | 'desktop' | 'unknown' {
    try {
        const value = raw.startsWith('"') ? JSON.parse(raw) : raw;
        return value === 'game' || value === 'desktop' ? value : 'unknown';
    } catch { return 'unknown'; }
}

const startedAt = Date.now();
let generation = 0;
let active = false;

/**
 * When Steam exports the server store, its OnServerNotification is the ingestion path for
 * eSource=2 notifications -- the one live server events take -- so a synthetic
 * rollup pushed through it exercises capture, extraction and routing exactly
 * as a real wishlist sale would. Valve's own server-type test methods are
 * stubbed out in the shipped build, which is why this door exists.
 */
let serverStore: any;

function findServerNotificationStore(): any {
	if (serverStore) return serverStore;
	try {
		serverStore = findModuleExport((e: any) => {
			try {
				return typeof e?.OnServerNotification === 'function' && typeof e?.MarkItemRead === 'function';
			} catch {
				return false;
			}
		});
	} catch (e) {
		dlog(`server store lookup failed: (enable verboseDiagnostics for details)`, () => `server store lookup failed: ${(e as Error)?.message ?? e}`);
	}
	return serverStore;
}

/**
 * A minimal rollup, shaped like the ones OnServerNotification receives:
 * everything the toast path reads from it is a plain property
 * (item.body_data, rgunread, timestamp), verified against the bundle.
 */
function serverRollup(type: number, body: unknown) {
	const id = Date.now() % 1_000_000_000;
	const now = Math.floor(Date.now() / 1000);
	return {
		type,
		rollup_key: id,
		item: {
			notification_id: id,
			// Bitfield of delivery targets; 8 is the toast bit, and
			// BToastEnabled falls back to this when the user has no stored
			// preference for the type. All bits set, so the fallback shows it.
			notification_targets: 15,
			notification_type: type,
			body_data: JSON.stringify(body ?? {}),
			read: false,
			viewed: 0,
			timestamp: now,
		},
		rgunread: [id],
		rgread: [] as number[],
		timestamp: now,
	};
}

function injectServerNotification(store: any, rollup: ReturnType<typeof serverRollup>): void {
	if (!store) throw new Error('Server notification store not found');
	const { type, item } = rollup;
	dlog(`dev-fire: OnServerNotification type=${type}`, () => `dev-fire: OnServerNotification type=${type} body=${item.body_data}`);
	store.OnServerNotification(rollup, 0 /* New */);
}

function sendSample(rollup: ReturnType<typeof serverRollup>): void {
    const preferences = Reflect.get(globalThis, 'settingsStore') ??
        findModuleExport((value: any) => typeof value?.GetClientSetting === 'function' && !!value?.clientSettings);
    const client = preferences?.clientSettings;
    const store = findServerNotificationStore();
    const native = Reflect.get(globalThis, 'NotificationStore');
    if (!client) throw new Error('Steam notification settings are unavailable.');
    if (client.disable_all_toasts) throw new Error('Steam notifications are disabled. Enable them in Notifications to send a test.');
    if (client.disable_toasts_in_game) {
        if (typeof native?.BIsUserInGame !== 'function') throw new Error('Steam notification context is unavailable. Try the test outside a game.');
        if (native.BIsUserInGame()) throw new Error('Steam in-game notifications are disabled. Enable them or try the test outside a game.');
    }
    const disabled = 'Steam General notification toasts are disabled. Enable them in Notifications to send a test.';
    if (typeof store?.BToastEnabled === 'function') {
        if (store.BToastEnabled(rollup.type, rollup.item) !== true) throw new Error(disabled);
        injectServerNotification(store, rollup);
        return;
    }

    // Steam Beta keeps the server store private. Use the General toast target
    // from its native notification store and the same per-type toast bit.
    const generalToast = 31;
    const target = native?.GetNotificationTargets?.()?.[generalToast];
    if (target?.strTest !== 'General' || typeof native?.ProcessNotification !== 'function') {
        throw new Error('Steam’s General notification test is unavailable on this client build.');
    }
    const preference = preferences.notificationPreferences?.find((entry: any) => entry.notification_type === rollup.type);
    if (!((preference ?? rollup.item).notification_targets & 8)) throw new Error(disabled);
    dlog('dev-fire: native General sample');
    native.ProcessNotification({ ...target, fnTray: null, showToast: true }, {
        notificationID: rollup.rollup_key, rtCreated: rollup.timestamp,
        eType: generalToast, eSource: 2, data: rollup, bNewIndicator: true,
    }, 0 /* New */);
}

/**
 * Overlay diagnostics: `info` dumps the overlay browser map (which games have
 * a live overlay surface). The door probes that drove the routing catalog
 * left with the catalog; this one stays because "does an overlay exist" is
 * the question the replay path's known limit turns on.
 */
async function runOverlayProbe(probe: { call?: string }): Promise<unknown> {
    try {
        if (probe.call !== 'info') throw new Error(`Unknown overlay probe: ${String(probe.call)}`);
        const sc: any = Reflect.get(globalThis, 'SteamClient');
        if (typeof sc?.Overlay?.GetOverlayBrowserInfo !== 'function') throw new Error('Overlay browser info API is unavailable');
        const info = await sc.Overlay.GetOverlayBrowserInfo();
        dlog('overlay-info: details disabled', () => `overlay-info: ${safeJson(info)}`.slice(0, 1500));
        return info;
    } catch (e) {
        dlog(`overlay probe failed: (enable verboseDiagnostics for details)`, () => `overlay probe failed: ${(e as Error)?.message ?? e}`);
        throw e;
    }
}
function assertLiveRequest(envelope: DevEnvelope, epoch: number, sample: boolean): void {
    if (!active || epoch !== generation) throw new Error('Developer frontend session is no longer active');
    if (!envelope || typeof envelope.id !== 'string' || !Number.isSafeInteger(envelope.deadline) || !Number.isSafeInteger(envelope.createdAt) || envelope.deadline <= Date.now() || envelope.createdAt < startedAt) throw new Error('Developer request expired or predates this Steam frontend');
    if (!sample && !settings().devFire) throw new Error('Developer commands are disabled');
}

export async function executeDevCommand(envelope: DevEnvelope, sample = false): Promise<unknown> {
    const epoch = generation;
    assertLiveRequest(envelope, epoch, sample);
    const cmd = validateDevCommand(sample ? sampleCommand() : envelope.command);
    let value: unknown = null;
    if ('focus' in cmd) { value = { appid: cmd.focus.appid, host: normalizeHostFocus(await hostMethod('GameHostFocus')(cmd.focus.appid)) }; }
    else if ('overlay' in cmd) { value = await runOverlayProbe(cmd.overlay); }
    else if ('replay' in cmd) {
        if (cmd.replay.call === 'inspect') value = inspectReplayStash();
        else {
            const surface = await currentClickSurface();
            assertLiveRequest(envelope, epoch, sample);
            if (!surface) throw new Error('Current capture surface unknown');
            value = invokeReplayHandler(cmd.replay.name, surface.focusedAppId);
            if (!value) throw new Error('Replay was refused or no matching handler exists');
        }
    } else if ('server' in cmd) {
        const rollup = serverRollup(cmd.server.type, cmd.server.body);
        if (sample) sendSample(rollup);
        else injectServerNotification(findServerNotificationStore(), rollup);
    } else {
        const store: any = Reflect.get(globalThis, 'NotificationStore');
        const fn = store?.[cmd.call];
        if (typeof fn !== 'function') throw new Error(`NotificationStore.${cmd.call} is unavailable`);
        dlog('dev-fire: NotificationStore command', () => `dev-fire: NotificationStore.${cmd.call}(${safeJson(cmd.args)})`);
        value = await fn.apply(store, cmd.args);
    }
    return { id: envelope.id, stage: 'executed', value: value ?? null, measurement: 'Execution completed; capture, delivery and banner visibility are unmeasured' };
}
export function startDevControl(): () => void {
    const epoch = ++generation;
    active = true;
    const control = async (envelope: DevEnvelope, sample = false) => {
        try { return { ok: true, value: await executeDevCommand(envelope, sample) }; }
        catch (e: any) { return { ok: false, error: e.message }; }
    };
    (globalThis as any).__snnDevControl = control;
    return () => {
        if (generation === epoch) {
            active = false;
            generation++;
            if ((globalThis as any).__snnDevControl === control) delete (globalThis as any).__snnDevControl;
        }
    };
}
