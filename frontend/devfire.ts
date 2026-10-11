import { validateDevCommand, type DevEnvelope } from '../shared/dev-command';
import { findModuleExport } from 'millennium';
import { hostMethod } from './host';
import { dlog, safeJson } from './log';
import { parseCallableJson, settings } from './settings';
import { inspectReplayStash, invokeReplayHandler } from './replay';
import { currentClickSurface } from './overlay';

/**
 * The tools/fire door: dev machinery, fenced off from the capture path.
 *
 * `tools/fire` writes a command file; the backend hands it over exactly once
 * via TakeDevCommand; the poll here executes it. A command either names a test
 * method on Steam's own NotificationStore (whose Test* functions push a real
 * synthesized notification through the full toast pipeline) or carries a
 * synthetic server rollup for injection.
 *
 * This is a name-and-args door into Steam's stores for anything that can write
 * the plugin's cache directory, so it is OFF by default and gated on the devFire
 * setting -- checked per tick, so the settings toggle takes effect without a
 * restart, and a disabled gate costs one boolean read every 3s.
 */
const takeDevCommand = hostMethod('TakeDevCommand');
const takeSampleCommand = hostMethod('TakeSampleCommand');

const DEV_POLL_MS = 3000;
const startedAt = Date.now();
let generation = 0;
let active = false;

/**
 * The server notification store is not a window global; it is found by webpack
 * export search. Its OnServerNotification is the real ingestion path for
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
		dlog(`server store lookup failed: ${(e as Error)?.message ?? e}`);
	}
	return serverStore;
}

/**
 * A minimal rollup, shaped like the ones OnServerNotification receives:
 * everything the toast path reads from it is a plain property
 * (item.body_data, rgunread, timestamp), verified against the bundle.
 */
function injectServerNotification(type: number, body: unknown): void {
	const store = findServerNotificationStore();
	if (!store) {
		throw new Error('Server notification store not found');
	}
	const id = Date.now() % 1_000_000_000;
	const now = Math.floor(Date.now() / 1000);
	const rollup = {
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
	dlog(`dev-fire: OnServerNotification type=${type} body=${safeJson(body)}`);
	store.OnServerNotification(rollup, 0 /* New */);
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
        dlog(`overlay-info: ${safeJson(info)}`.slice(0, 1500));
        return info;
    } catch (e) {
        dlog(`overlay probe failed: ${(e as Error)?.message ?? e}`);
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
    const cmd = validateDevCommand(sample ? { call: 'TestFriendOnline', args: [] } : envelope.command);
    let value: unknown = null;
    if ('overlay' in cmd) { value = await runOverlayProbe(cmd.overlay); }
    else if ('replay' in cmd) {
        if (cmd.replay.call === 'inspect') value = inspectReplayStash();
        else {
            const surface = await currentClickSurface();
            assertLiveRequest(envelope, epoch, sample);
            if (!surface) throw new Error('Current capture surface unknown');
            value = invokeReplayHandler(cmd.replay.name, surface.focusedAppId);
            if (!value) throw new Error('Replay was refused or no matching handler exists');
        }
    } else if ('server' in cmd) { injectServerNotification(cmd.server.type, cmd.server.body); }
    else {
        const store: any = Reflect.get(globalThis, 'NotificationStore');
        const fn = store?.[cmd.call];
        if (typeof fn !== 'function') throw new Error(`NotificationStore.${cmd.call} is unavailable`);
        dlog(`dev-fire: NotificationStore.${cmd.call}(${safeJson(cmd.args)})`);
        value = await fn.apply(store, cmd.args);
    }
    return { id: envelope.id, stage: 'executed', value: value ?? null, measurement: 'Execution completed; capture, delivery and banner visibility are unmeasured' };
}
export function startDevFirePoll(): () => void {
    const epoch = ++generation;
    active = true;
    (globalThis as any).__snnDevControl = async (envelope: DevEnvelope, sample = false) => {
        try { return { ok: true, value: await executeDevCommand(envelope, sample) }; }
        catch (e: any) { return { ok: false, error: e.message }; }
    };
    const timer = window.setInterval(async () => {
        if (!active || generation !== epoch) return;
        try {
            const sampleRaw = await takeSampleCommand();
            const sample = parseCallableJson<any>(sampleRaw, null);
            if (sample && typeof sample.id === 'string' && Number.isSafeInteger(sample.deadline)) {
                const result = await (globalThis as any).__snnDevControl(sample, true);
                dlog(`dev-fire: sample result ${safeJson({ id: sample.id, ...result })}`);
            }
            if (!settings().devFire) return;
            const raw = await takeDevCommand();
            const parsed = parseCallableJson<any>(raw, null);
            if (!parsed) return;
            if (!parsed.command) throw new Error('Legacy developer command lacks expiry; rerun tools/fire from the current build');
            const envelope: DevEnvelope = parsed;
            const result = await (globalThis as any).__snnDevControl(envelope);
            dlog(`dev-fire: result ${safeJson({ id: envelope.id, ...result })}`);
        } catch (e: any) { dlog(`dev-fire failed: ${e.message}`); }
    }, DEV_POLL_MS);
    return () => {
        window.clearInterval(timer);
        if (generation === epoch) { active = false; generation++; delete (globalThis as any).__snnDevControl; }
    };
}
