import { ffi, findModuleExport } from 'millennium';
import { dlog, safeJson } from './log';

/**
 * The in-game overlay's web-page door, verified live 2026-08-29 (a synthetic
 * request opened the overlay browser on the gifts page in Helldivers 2).
 *
 * No external steam:// URL reaches the overlay browser: the documented
 * steam://overlay command is gone from current binaries, and an externally
 * invoked steam://openexternalforpid never reaches its JS handler -- the
 * client raises its main window over the game instead. The overlay is driven
 * from THIS context: one store registers
 * SteamClient.Overlay.RegisterForActivateOverlayRequests and its
 * OnGameOverlayActivateRequested routes web-page requests into the overlay
 * navigator (RouteNavigateToSteamWeb -> GetInstanceForAppID(...).
 * NavigateToSteamWeb). The request shape below is the one the bundle's own
 * steam://openexternalforpid parser builds.
 */
let overlayStore: any;
const gameHostFocus = ffi<[number], string>('GameHostFocus');

/**
 * Live game-focus state, from the client's own signal. Steam places toasts by
 * focus too, but its placement can lag on this compositor (observed: an
 * overlay-context toast while the game was backgrounded), so the click bridge
 * re-checks focus at CLICK time instead of trusting the notify-time context.
 */
/** undefined precedes the first focus event; null marks an invalid event. */
let focusedOverlayAppId: number | null | undefined;

export function trackOverlayFocus(): void {
	focusedOverlayAppId = undefined;
	try {
		const sc: any = Reflect.get(globalThis, 'SteamClient');
		sc?.System?.UI?.RegisterForOverlayGameWindowFocusChanged?.((appid: unknown) => {
			// Steam app IDs are uint32; coercion could turn a failed signal into desktop.
			focusedOverlayAppId = typeof appid === 'number' && Number.isInteger(appid) && appid >= 0 && appid <= 0xffffffff
				? appid : null;
		});
	} catch (e) {
		dlog(`overlay focus tracking failed: ${(e as Error)?.message ?? e}`);
	}
}

export function findOverlayStore(): any {
	if (overlayStore) return overlayStore;
	try {
		overlayStore = findModuleExport((e: any) => {
			try {
				return (
					typeof e?.OnGameOverlayActivateRequested === 'function' &&
					typeof e?.OnSteamURLOpenExternalForPID === 'function'
				);
			} catch {
				return false;
			}
		});
	} catch (e) {
		dlog(`overlay store lookup failed: ${(e as Error)?.message ?? e}`);
	}
	return overlayStore;
}

/**
 * Resolve the click surface from overlay instances and the live focus signal.
 * Missing, malformed, or contradictory discovery is unknown, never desktop.
 * An empty instance list confirms desktop even before the first focus event.
 */
export async function currentClickSurface(): Promise<{ runningAppId: number | null; focusedAppId: number } | null> {
	try {
		const sc: any = Reflect.get(globalThis, 'SteamClient');
		const info = await sc?.Overlay?.GetOverlayBrowserInfo?.();
		if (!Array.isArray(info)) return null;
		const appids = info.map((entry: any) => Number(entry?.appID));
		if (appids.some((appid) => !Number.isSafeInteger(appid) || appid <= 0)) return null;
		const focused = focusedOverlayAppId;
		if (focused === null) return null;
		if (focused !== undefined && focused > 0) {
			if (!appids.includes(focused)) return null;
			// Nested Gamescope can retain inner game focus after its host loses
			// focus. Only a positively identified host may override Steam.
			try {
				const host = await gameHostFocus(focused);
				dlog(`focus-host: appid=${focused} result=${host}`);
				if (host === 'desktop' || host === '"desktop"') {
					return { runningAppId: focused, focusedAppId: 0 };
				}
			} catch { /* An unavailable host probe leaves Steam's selection intact. */ }
			return { runningAppId: focused, focusedAppId: focused };
		}
		if (appids.length === 0) return { runningAppId: null, focusedAppId: 0 };
		return focused === 0 ? { runningAppId: appids[0], focusedAppId: 0 } : null;
	} catch {
		return null;
	}
}

async function sendOverlayRequest(appid: number, bWebPage: boolean, strDialog: string, steamidTarget: string = '0'): Promise<boolean> {
	const store = findOverlayStore();
	if (!store) return false;
	const request = {
		unRequestingAppID: appid,
		appid,
		bWebPage,
		strDialog,
		eWebPageMode: 0 /* Default: non-modal, RouteNavigateToSteamWeb */,
		steamidTarget,
		eFlag: 0 /* OverlayToStoreFlag_None */,
		strConnectString: '',
	};
	dlog(`overlay: open appid=${appid} ${safeJson(strDialog)} target=${steamidTarget}`);
	return (await store.OnGameOverlayActivateRequested(request)) !== false;
}

/**
 * Open a 1:1 chat in the game's overlay -- the ingestion's "chat" case, i.e.
 * the SDK's ActivateGameOverlayToUser("chat", steamid). Needed because an
 * external steam://friends/message URL lets the client pick the surface, and
 * it picks the overlay whenever a game is running, focused or not.
 */
export function openChatInOverlay(appid: number, steamid64: string): Promise<boolean> {
	return sendOverlayRequest(appid, false, 'chat', steamid64);
}

/**
 * Open a 1:1 chat on the DESKTOP explicitly: the same ingestion case with
 * appid 0, whose GetInstanceForAppID resolves the desktop instance. Used when
 * a game is running but unfocused -- the external friends/message URL would
 * open the overlay chat invisibly.
 */
export function openChatOnDesktop(steamid64: string): Promise<boolean> {
	return sendOverlayRequest(0, false, 'chat', steamid64);
}

/** Open a web page in the running game's overlay browser. */
export function openInOverlay(appid: number, url: string): Promise<boolean> {
	return sendOverlayRequest(appid, true, url);
}

/**
 * Open one of the handler's named dialogs in the overlay -- the SDK's
 * ActivateGameOverlay vocabulary ("settings", "friends", "community",
 * "requestplaytime", ...). Note "settings" is hard-wired to
 * Settings("System") in the handler, which is exactly where a SystemUpdate
 * click goes.
 */
export function openDialogInOverlay(appid: number, dialog: string): Promise<boolean> {
	return sendOverlayRequest(appid, false, dialog);
}

/**
 * The playtime request dialog, the way Steam's own toast click opens it:
 * navigator.RequestPlaytimeDialog("manual"). Each surface's navigator does
 * the right thing -- the desktop one (appid 0) shows the main-window dialog,
 * the overlay one routes through the activate-overlay request list.
 */
export async function openPlaytimeDialog(appid: number): Promise<boolean> {
	const store = findOverlayStore();
	if (!store) return false;
	try {
		const nav = store.GetNavigator({ unRequestingAppID: appid });
		if (typeof nav?.RequestPlaytimeDialog !== 'function') {
			dlog('overlay: navigator has no RequestPlaytimeDialog');
			return false;
		}
		dlog(`overlay: playtime dialog appid=${appid}`);
		return (await nav.RequestPlaytimeDialog('manual')) !== false;
	} catch (e) {
		dlog(`overlay: playtime dialog failed: ${(e as Error)?.message ?? e}`);
		return false;
	}
}

/**
 * Open the overlay's Recordings & Screenshots view. The activate-overlay
 * ingestion has no media case; Steam's own in-game screenshot toast click
 * navigates its overlay context to the media grid, and the same navigator is
 * reachable here through the store's GetNavigator.
 */
/**
 * Open one specific screenshot in the overlay's media view, the way Steam's
 * own in-game screenshot toast click does: nav.Media.Screenshot({state:{id}})
 * with the notification's screenshot_handle as the id.
 */
export async function openScreenshotInOverlay(appid: number, id: string): Promise<boolean> {
	const store = findOverlayStore();
	if (!store) return false;
	try {
		const nav = store.GetNavigator({ unRequestingAppID: appid });
		if (typeof nav?.Media?.Screenshot !== 'function') {
			dlog('overlay: navigator has no Media.Screenshot');
			return false;
		}
		dlog(`overlay: screenshot appid=${appid} id=${id}`);
		return (await nav.Media.Screenshot({ state: { id } })) !== false;
	} catch (e) {
		dlog(`overlay: screenshot failed: ${(e as Error)?.message ?? e}`);
		return false;
	}
}

/**
 * Open one specific clip, the way Steam's own recording toast click does:
 * nav.Media.Clip({state:{id}}) with the notification's clip_id.
 */
export async function openClipInOverlay(appid: number, id: string): Promise<boolean> {
	const store = findOverlayStore();
	if (!store) return false;
	try {
		const nav = store.GetNavigator({ unRequestingAppID: appid });
		if (typeof nav?.Media?.Clip !== 'function') {
			dlog('overlay: navigator has no Media.Clip');
			return false;
		}
		dlog(`overlay: clip appid=${appid} id=${id}`);
		return (await nav.Media.Clip({ state: { id } })) !== false;
	} catch (e) {
		dlog(`overlay: clip failed: ${(e as Error)?.message ?? e}`);
		return false;
	}
}

export async function openMediaInOverlay(appid: number): Promise<boolean> {
	const store = findOverlayStore();
	if (!store) return false;
	try {
		const nav = store.GetNavigator({ unRequestingAppID: appid });
		if (typeof nav?.Media?.Grid !== 'function') {
			dlog('overlay: navigator has no Media.Grid');
			return false;
		}
		dlog(`overlay: media appid=${appid}`);
		return (await nav.Media.Grid()) !== false;
	} catch (e) {
		dlog(`overlay: media failed: ${(e as Error)?.message ?? e}`);
		return false;
	}
}
