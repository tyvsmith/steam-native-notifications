import { definePlugin, ffi, IconsModule } from 'millennium';
import { CLICK_PAYLOAD_PREFIX, captureAppIdFromToastName, encodeClickEnvelope, focusKindFor, newClickToken } from './click';
import { typeName } from './generated/notifications';
import { setIdentity } from './identity';
import { notificationFromToast, type DecodedNotification } from './notification';
import { dlog, safeJson } from './log';
import { startClickBridge } from './clickbridge';
import { trackOverlayFocus } from './overlay';
import { clientOverlayAction, clientRoute, DEFAULT_STEAM_ROUTE, serverRoute } from './routes';
import { startDevFirePoll } from './devfire';
import { stashToastHandler } from './replay';
import { registerSteamUrlClicks } from './steamurl';
import { SettingsPanel } from './SettingsPanel';
import { loadSettings, parseCallableJson, settings } from './settings';
import { loadUrlTemplates } from './urlstore';
import { splitToastText } from './toasttext';

/**
 * Steam draws every notification as its own CEF popup window, named
 * `notificationtoasts_<N>_desktop`. The window title is all the compositor can
 * see; the text a person reads only exists in that popup's DOM. So the bridge
 * has to live in here, where the document is reachable.
 *
 * This file owns the popup lifecycle: hook the popup manager, wait for a toast
 * to paint, deliver it once, close it if asked. What a click does lives
 * elsewhere -- replay.ts stashes Steam's own click handler from the toast's
 * tree, and the click bridge re-runs it; notification.ts decodes Steam's
 * attached object for the log line.
 *
 * `g_PopupManager` is not public API. It is what the shipping
 * kitsune-notifications plugin uses to find the same windows, which is the only
 * reason to trust it. If Valve renames it, `installHook` gives up quietly after
 * MANAGER_RETRY_LIMIT tries and the bridge goes silent rather than throwing.
 */
interface SteamPopup {
	window?: (Window & typeof globalThis) | null;
}

interface Registration {
	Unregister(): void;
}

interface SteamPopupManager {
	AddPopupCreatedCallback(cb: (popup: SteamPopup) => void): Registration;
	AddPopupDestroyedCallback(cb: (popup: SteamPopup) => void): Registration;
}

const TOAST_PREFIX = 'notificationtoasts_';

/**
 * Positional over the ffi bridge: title, body, image, route, ingame -- the
 * same five slots backend/main.lua hands to tools/notify-action. (The old
 * callable transport mapped a multi-key argument object onto Lua parameters
 * in no defined order -- summary and body once arrived swapped -- which is
 * why everything used to travel as one JSON string.)
 */
const notify = ffi<[string, string, string, string, string], string>('Notify');
const identity = ffi<[], string>('Identity');

/**
 * The popup window exists before it has painted, so a single settle delay is a
 * guess that goes wrong on a slow frame. Poll for content instead: a late toast
 * is delivered late rather than delivered empty.
 */
const READ_INTERVAL_MS = 80;
const READ_ATTEMPTS = 15; // ~1.2s before giving up on a toast

const MANAGER_RETRY_MS = 500;
const MANAGER_RETRY_LIMIT = 60; // ~30s, covers a cold Steam start

/** Toast names already sent, so a re-fired callback cannot double-notify. */
const delivered = new Set<string>();
const registrations: Registration[] = [];

function routeFor(notification: DecodedNotification): string | null {
	if (notification.source === 'millennium') return notification.fallback;
	return notification.source === 'client'
		? clientRoute(notification.type, notification.fields)
		: serverRoute(notification.server);
}

// --------------------------------------------------------------------------
// toast capture
// --------------------------------------------------------------------------

function toastName(popup: SteamPopup): string | null {
	const name = popup.window?.name;
	if (!name || name.indexOf(TOAST_PREFIX) !== 0) return null;
	return name;
}

/**
 * The capsule or avatar the toast is showing. Game art comes from Steam's own
 * virtual host and a friend's avatar from the public CDN; the helper knows how
 * to resolve either, so the raw reference is passed through untouched.
 */
function toastImage(win: Window): string | null {
	try {
		const first = Array.from(win.document?.images ?? [])
			.map((i) => i.src)
			.find(Boolean);
		return first ?? null;
	} catch {
		return null;
	}
}

/**
 * Wait for the toast to paint, then hand it to deliverToast. Polls at
 * READ_INTERVAL_MS for up to READ_ATTEMPTS (~1.2s); a toast that closes first
 * or never paints is logged and dropped, never delivered empty.
 */
function readWhenPainted(win: Window, name: string, attempt: number = 0): void {
	if (win.closed) {
		dlog(`toast ${name} closed before it painted`);
		return;
	}

	const text = (win.document?.body?.innerText ?? '').trim();

	if (!text) {
		if (attempt < READ_ATTEMPTS) {
			setTimeout(() => readWhenPainted(win, name, attempt + 1), READ_INTERVAL_MS);
		} else {
			dlog(`toast ${name} never painted any text`);
		}
		return;
	}

	deliverToast(win, name, text);
}

/**
 * Deliver one painted toast: at most once per popup name, never throwing, and
 * only after a successful read -- Steam's own popup is closed at the end, and
 * a toast this function could not read stays on screen rather than being
 * silently swallowed.
 */
function deliverToast(win: Window, name: string, text: string): void {
	if (delivered.has(name)) return;
	delivered.add(name);

	const { title, body } = splitToastText(text);
	const image = toastImage(win);
	const fromToast = notificationFromToast(win);
	// Steam renders each toast in the surface the user is on: overlay-context
	// names (notificationtoasts_uid<appid>-...) mean the game was focused,
	// _desktop names mean it was not -- even with a game running.
	const captureAppId = captureAppIdFromToastName(name);
	const overlayCtx = captureAppId !== null && captureAppId > 0;

	let type: number | undefined;
	let kind: string | undefined;
	let catalogRoute: string | null = null;
	let overlayAction: string | null = null;
	try {
		if (fromToast) {
			type = fromToast.type;
			kind = fromToast.source === 'millennium' ? fromToast.kind : typeName(type);
			catalogRoute = routeFor(fromToast);
			if (fromToast.source === 'client') overlayAction = clientOverlayAction(type, fromToast.fields);
			const detail =
				fromToast.source === 'server'
					? `server type=${fromToast.server.type} url=${fromToast.server.url ?? ''} body=${safeJson(fromToast.server.body)}`
					: fromToast.source === 'millennium'
						? `millennium fallback=${fromToast.fallback}`
						: `fields=${safeJson(fromToast.fields)}`;
			dlog(`from-toast ${name} type=${type} (${kind}) source=${fromToast.source} ${detail}`.slice(0, 700));
		} else {
			kind = 'Unknown';
			catalogRoute = DEFAULT_STEAM_ROUTE;
			dlog(`from-toast ${name} unknown: no attached notification`);
		}
	} catch (e) {
		dlog(`from-toast ${name} failed: ${(e as Error)?.message ?? e}`);
		catalogRoute = null;
		overlayAction = null;
	}
	// A suppressed toast is left entirely to Steam: nothing sent, popup not
	// closed (hideSteamToast included). Capture and the logs above still run.
	const suppressed = overlayCtx ? !settings().notifyInGame : !settings().notifyOutsideGame;
	let clickPayload = '';
	let replayable = false;
	const fallback = catalogRoute ?? (overlayAction ? `action:${overlayAction}` : null);
	if (!suppressed) {
		try {
			const token = newClickToken();
			replayable = stashToastHandler(win, name, token);
			if (captureAppId !== null && (replayable || fallback)) {
				clickPayload =
					CLICK_PAYLOAD_PREFIX +
					encodeClickEnvelope({
						v: 1,
						token,
						captureAppId,
						fallback,
						focus: focusKindFor(type, fallback),
					});
			}
		} catch (e) {
			dlog(`click envelope failed for ${name}: ${(e as Error)?.message ?? e}`);
		}
	}
	dlog(
		`toast ${name} -> ${safeJson({ title, body, image, type, kind, replayable, fallback, click: Boolean(clickPayload) })}` +
			(suppressed ? ` (suppressed: ${overlayCtx ? 'in-game' : 'desktop'} notifications off)` : ''),
	);
	// The backend/notify-action contract is unchanged (five positional args);
	// the click envelope travels in the route slot and returns through the
	// platform's action transport.
	const notifyResult: Promise<string> | null = suppressed
		? null
		: notify(title, body, image ?? '', clickPayload, '');

	// Closing Steam's own popup is what stops a notification being reported
	// twice. Done here rather than with a compositor rule because the plugin
	// knows the read succeeded, and because it works on any window manager.
	// Gated on the backend answering "ok": a platform whose delivery is not
	// implemented, or a failed spawn, must leave Steam's own toast alone or
	// the notification vanishes entirely. The answer can arrive raw or
	// JSON-quoted depending on the transport.
	if (settings().hideSteamToast && notifyResult) {
		void notifyResult
			.then((result: string) => {
				if (result !== 'ok' && result !== '"ok"') {
					dlog(`toast ${name} left open: backend answered ${String(result).slice(0, 60)}`);
					return;
				}
				try {
					win.close();
				} catch (e) {
					dlog(`could not close ${name}: ${(e as Error)?.message ?? e}`);
				}
			})
			.catch((e: unknown) => dlog(`toast ${name} left open: notify failed: ${(e as Error)?.message ?? e}`));
	}
}

async function loadIdentity(): Promise<void> {
	try {
		const parsed = parseCallableJson<{ steamid64?: string }>(await identity(), {});
		const id = setIdentity(parsed?.steamid64);
		dlog(`identity: steamid64=${id ?? '(none)'}`);
	} catch (e) {
		dlog(`identity failed: ${(e as Error)?.message ?? e}`);
	}
}

function onPopupCreated(popup: SteamPopup): void {
	const name = toastName(popup);
	if (!name || !popup.window) return;
	readWhenPainted(popup.window, name, 0);
}

function onPopupDestroyed(popup: SteamPopup): void {
	const name = toastName(popup);
	// Names carry an incrementing counter, so a destroyed one never comes back.
	// Dropping it here keeps the set from growing for the life of the session.
	if (name) delivered.delete(name);
}

function installHook(attempt: number = 0): void {
	const mgr = Reflect.get(globalThis, 'g_PopupManager') as SteamPopupManager | undefined;

	if (!mgr) {
		if (attempt < MANAGER_RETRY_LIMIT) {
			setTimeout(() => installHook(attempt + 1), MANAGER_RETRY_MS);
		} else {
			dlog('g_PopupManager never appeared; bridge inactive');
		}
		return;
	}

	try {
		registrations.push(mgr.AddPopupCreatedCallback(onPopupCreated));
		registrations.push(mgr.AddPopupDestroyedCallback(onPopupDestroyed));
		dlog('hook installed');
	} catch (e) {
		dlog(`hook failed: ${(e as Error)?.message ?? e}`);
	}
}

/**
 * IconsModule is typed `any` and resolved from Steam's webpack bundle at
 * runtime, so a name that does not exist compiles cleanly and then renders as
 * undefined -- which React reports as error #130 and which takes down the whole
 * Steam UI, not just this panel. Pick the first name that actually resolves, and
 * fall back to no icon rather than to a crash.
 */
function pluginIcon(): any {
	const icons: any = IconsModule;
	for (const name of ['Notification', 'Bell', 'Settings', 'Gear']) {
		const candidate = icons?.[name];
		if (typeof candidate === 'function' || typeof candidate === 'object') {
			try {
				return window.SP_REACT.createElement(candidate, {});
			} catch {
				/* try the next one */
			}
		}
	}
	return null;
}

export default definePlugin(() => {
	void loadSettings();
	void loadIdentity();
	void loadUrlTemplates().then((summary) => dlog(`url templates: ${summary}`));
	trackOverlayFocus();
	installHook();
	startDevFirePoll();
	startClickBridge();
	// Linux and Windows return the durable envelope through the canonical
	// steam://steam-native-notify/notification/<payload> URL.
	const steamUrl = registerSteamUrlClicks();

	return {
		title: 'Steam Native Notify',
		icon: pluginIcon(),
		content: <SettingsPanel />,
		onDismount() {
			try {
				steamUrl?.unregister();
			} catch {
				/* Steam tore the dispatch down first; nothing to release. */
			}
			for (const r of registrations.splice(0)) {
				try {
					r.Unregister();
				} catch {
					/* Steam tore the manager down first; nothing to release. */
				}
			}
		},
	} as any;
});
