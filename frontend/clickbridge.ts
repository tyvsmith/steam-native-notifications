import { ffi } from 'millennium';
import { decodeClickPayload, deliveryMode, surfaceMatches, type ClickEnvelope, type FocusKind } from './click';
import { dlog } from './log';
import { invokeReplayHandler } from './replay';
import { DEFAULT_STEAM_ROUTE } from './routes';
import {
	openChatInOverlay,
	openChatOnDesktop,
	openClipInOverlay,
	openDialogInOverlay,
	openInOverlay,
	openMediaInOverlay,
	openPlaytimeDialog,
	openScreenshotInOverlay,
	currentClickSurface,
} from './overlay';

/**
 * The click bridge: every notification click is delivered through here.
 *
 * Production helpers expose the versioned envelope through the canonical Steam
 * URL, which frontend/steamurl.ts sends to dispatchClick. The retained
 * timestamped click-file input is a legacy/test seam. Both entries prefer exact
 * handler replay while the capture surface still matches, then fall back to the
 * restored catalog against the live click surface.
 */
const takeClick = ffi<[], string>('TakeClick');
const focusSteam = ffi<[string], string>('FocusSteam');

const CLICK_POLL_MS = 1000;
/**
 * A legacy/test writer stamps each click with its write time (<epoch-seconds>|
 * <payload>). The session-long poll may observe an abandoned write after a
 * delay, so old writes are dropped instead of opened as a surprise. Canonical
 * URL activation does not use this age limit.
 */
const CLICK_MAX_AGE_S = 30;

const OPENURL_PREFIX = 'steam://openurl/';

let timer: number | null = null;

function requestFocus(kind: FocusKind): void {
	void focusSteam(kind).catch((e: unknown) => dlog(`focus request failed: ${(e as Error)?.message ?? e}`));
}

/**
 * Raise the main window if it exists; closed to the tray, its popup is
 * destroyed and the appid-0 instance has no surface, so it is opened first
 * through the client's own URL executor (steam://open/main -- the same thing
 * launcher activation does). Returns true when the window already existed.
 */
async function ensureMainWindow(): Promise<boolean> {
	try {
		const mgr: any = Reflect.get(globalThis, 'g_PopupManager');
		const popups: Iterable<any> = mgr?.m_mapPopups?.values?.() ?? [];
		for (const popup of popups) {
			const win = popup?.window ?? popup?.m_popup;
			if (typeof win?.name === 'string' && win.name.startsWith('SP Desktop')) {
				win.SteamClient?.Window?.BringToFront?.();
				return true;
			}
		}
	} catch (e) {
		dlog(`click-bridge: raise failed: ${(e as Error)?.message ?? e}`);
	}
	try {
		dlog('click-bridge: main window closed; opening it');
		const sc: any = Reflect.get(globalThis, 'SteamClient');
		await sc?.URL?.ExecuteSteamURL?.('steam://open/main');
	} catch (e) {
		dlog(`click-bridge: open main failed: ${(e as Error)?.message ?? e}`);
	}
	return false;
}

function mainWindowPresent(): boolean {
	try {
		const mgr: any = Reflect.get(globalThis, 'g_PopupManager');
		const popups: Iterable<any> = mgr?.m_mapPopups?.values?.() ?? [];
		for (const popup of popups) {
			const win = popup?.window ?? popup?.m_popup;
			if (typeof win?.name === 'string' && win.name.startsWith('SP Desktop')) return true;
		}
	} catch {
		/* treated as absent */
	}
	return false;
}

/**
 * Run a desktop door once the main window is up. A freshly created window is
 * POLLED for (its popup appearing in g_PopupManager) rather than trusted to a
 * fixed delay: on a slow start a blind timer fires the door against nothing
 * and the click is silently lost.
 */
async function afterMainWindow(fn: () => boolean | Promise<boolean>): Promise<boolean> {
	if (!(await ensureMainWindow())) {
		const present = await new Promise<boolean>((resolve) => {
			const deadline = Date.now() + 6000;
			const poll = window.setInterval(() => {
				const ready = mainWindowPresent();
				if (!ready && Date.now() < deadline) return;
				window.clearInterval(poll);
				resolve(ready);
			}, 250);
		});
		if (!present) {
			dlog('click-bridge: main window did not appear; dispatch refused');
			return false;
		}
	}
	return fn();
}

/**
 * One dispatch for the action tokens, on either surface: appid 0 is the
 * desktop instance (proven by the desktop chat fix; Steam's own desktop
 * clicks for these types open the media page and the playtime dialog in the
 * main window), any other appid the game's overlay. Adding a token here
 * covers both surfaces at once.
 */
async function runActionToken(appid: number, route: string): Promise<boolean> {
	const surface = appid === 0 ? 'desktop' : 'overlay';
	let opened: boolean;
	if (route.startsWith('action:screenshot:')) {
		opened = await openScreenshotInOverlay(appid, route.slice('action:screenshot:'.length));
	} else if (route.startsWith('action:clip:')) {
		opened = await openClipInOverlay(appid, route.slice('action:clip:'.length));
	} else if (route === 'action:media') {
		opened = await openMediaInOverlay(appid);
	} else if (route === 'action:requestplaytime') {
		// The overlay renders this through the ingestion's dialog-request
		// list; the desktop has no container for it and uses the navigator
		// door instead. Both observed.
		opened = await (appid === 0 ? openPlaytimeDialog(0) : openDialogInOverlay(appid, 'requestplaytime'));
	} else {
		dlog(`click-bridge: unbridgeable action ${route}`);
		return false;
	}
	if (!opened) dlog(`click-bridge: ${surface} door failed`);
	return opened;
}

function desktopClick(route: string): Promise<boolean> {
	if (route.startsWith('action:')) {
		return afterMainWindow(() => runActionToken(0, route));
	}
	// Navigate once the window exists; a freshly created one needs its settle
	// before the URL executor can land a page change in it.
	return afterMainWindow(async () => {
		try {
			const sc: any = Reflect.get(globalThis, 'SteamClient');
			if (typeof sc?.URL?.ExecuteSteamURL !== 'function') return false;
			dlog(`click-bridge: desktop ${route}`);
			return (await sc.URL.ExecuteSteamURL(route)) !== false;
		} catch (e) {
			dlog(`click-bridge: navigate failed: ${(e as Error)?.message ?? e}`);
			return false;
		}
	});
}

function isDesktopOnlyRoute(route: string): boolean {
	return route === DEFAULT_STEAM_ROUTE || route.startsWith('steam://millennium/');
}

async function dispatchFallback(runningAppId: number | null, focusedAppId: number, route: string): Promise<boolean> {
	// Older envelopes can still carry this session-dependent action. Refuse
	// before creating or raising a window; only their captured callback is safe.
	if (route.startsWith('action:chatroom:')) {
		dlog('click-bridge: group chat has no durable fallback');
		return false;
	}
	if (isDesktopOnlyRoute(route)) return desktopClick(route);
	const focused = focusedAppId > 0;
	if (route.startsWith('steam://friends/message/')) {
		const sid = route.slice('steam://friends/message/'.length);
		if (focused) {
			return openChatInOverlay(focusedAppId, sid);
		} else if (runningAppId !== null) {
			return afterMainWindow(() => openChatOnDesktop(sid));
		} else {
			return desktopClick(route);
		}
	}
	if (!focused) {
		return desktopClick(route);
	}
	if (route.startsWith('action:')) {
		return runActionToken(focusedAppId, route);
	}
	let opened: boolean;
	if (route.startsWith(OPENURL_PREFIX)) {
		opened = await openInOverlay(focusedAppId, route.slice(OPENURL_PREFIX.length));
	} else if (route.startsWith('steam://settings/')) {
		opened = await openDialogInOverlay(focusedAppId, 'settings');
	} else if (route.startsWith('steam://nav/')) {
		dlog(`click-bridge: inert in-game, mirrors Steam: ${route}`);
		return true;
	} else {
		dlog(`click-bridge: unbridgeable route ${route}`);
		return false;
	}
	if (!opened) dlog('click-bridge: overlay door failed');
	return opened;
}

export async function dispatchClick(envelope: ClickEnvelope): Promise<void> {
	try {
		const surface = await currentClickSurface();
		if (!surface) {
			dlog('click-bridge: current surface unknown; dispatch refused');
			return;
		}
		const { runningAppId, focusedAppId } = surface;
		const replayed = surfaceMatches(envelope.captureAppId, focusedAppId)
			? invokeReplayHandler(envelope.token, focusedAppId)
			: false;
		const mode = deliveryMode(envelope, focusedAppId, replayed);
		if (mode === 'replay') {
			dlog(`click-bridge: replay token=${envelope.token.slice(0, 8)}`);
			if (focusedAppId === 0) requestFocus(envelope.focus);
			return;
		}
		if (mode === 'none' || !envelope.fallback) {
			dlog(`click-bridge: no verified fallback token=${envelope.token.slice(0, 8)}`);
			return;
		}
		dlog(`click-bridge: fallback ${envelope.fallback}`);
		if (
			(await dispatchFallback(runningAppId, focusedAppId, envelope.fallback)) &&
			(focusedAppId === 0 || isDesktopOnlyRoute(envelope.fallback))
		) {
			requestFocus(envelope.focus);
		}
	} catch (e) {
		dlog(`click-bridge failed: ${(e as Error)?.message ?? e}`);
	}
}

export function startClickBridge(): void {
	if (timer !== null) return;
	timer = window.setInterval(async () => {
		try {
			const raw = await takeClick();
			const taken =
				typeof raw === 'string' && raw ? (raw.startsWith('"') ? (JSON.parse(raw) as string) : raw) : '';
			if (typeof taken !== 'string' || !taken) return;
			const sep = taken.indexOf('|');
			const stamp = sep > 0 ? Number(taken.slice(0, sep)) : NaN;
			const payload = sep > 0 ? taken.slice(sep + 1) : '';
			if (!Number.isFinite(stamp) || !payload) {
				dlog(`click-bridge: unstamped click dropped: ${taken.slice(0, 120)}`);
				return;
			}
			const age = Math.round(Date.now() / 1000 - stamp);
			if (age > CLICK_MAX_AGE_S) {
				dlog(`click-bridge: stale click dropped (${age}s old)`);
				return;
			}
			const envelope = decodeClickPayload(payload);
			if (!envelope) {
				dlog(`click-bridge: malformed payload dropped: ${payload.slice(0, 80)}`);
				return;
			}
			await dispatchClick(envelope);
		} catch (e) {
			dlog(`click-bridge poll failed: ${(e as Error)?.message ?? e}`);
		}
	}, CLICK_POLL_MS);
}
