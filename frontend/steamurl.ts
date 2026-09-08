import { dlog } from './log';
import { clickEnvelopeFromSteamUrl, STEAM_URL_RESOURCE, STEAM_URL_SECTION } from './click';
import { dispatchClick } from './clickbridge';

/**
 * The cross-platform click transport: Steam's own steam:// dispatch.
 *
 * A desktop notification cannot reach this plugin directly on Windows.
 * Measured on Windows 11 (docs/platforms.md): a toast activates
 * `activationType="protocol"` only for schemes Windows already knows --
 * `ms-settings:`, `http:`, and `steam:` all launch; a scheme this plugin
 * registers itself never does, under every registration tried. Steam's own
 * scheme is therefore the way in, and Steam hands a steam:// URL to the
 * client's JS, where this plugin lives.
 *
 * `RegisterForRunSteamURL` takes any section name (Millennium registers
 * `millennium` the same way), so a toast carries a versioned envelope
 * in `steam://steam-native-notifications/notification/<base64url>`. Windows stores
 * that URI in the toast; Linux launches it after a live default action.
 *
 * Quickshell also receives the fixed `steam`, URL argv pair that Quattro can
 * keep with notification history. Both platforms therefore enter the same
 * validated dispatcher without persisting a JavaScript closure.
 */
interface Unregisterable {
	unregister(): void;
}

interface SteamUrlApi {
	RegisterForRunSteamURL(section: string, callback: (n: number, url: string) => void): Unregisterable;
}

/**
 * Never throws: a failed registration must leave delivery untouched, and an
 * older client without the API simply has no notification click path.
 */
export function registerSteamUrlClicks(): Unregisterable | null {
	try {
		const api = (Reflect.get(globalThis, 'SteamClient') as { URL?: SteamUrlApi } | undefined)?.URL;
		if (typeof api?.RegisterForRunSteamURL !== 'function') {
			dlog('steam-url: RegisterForRunSteamURL unavailable; no steam:// click path');
			return null;
		}
		const registration = api.RegisterForRunSteamURL(STEAM_URL_SECTION, (_n: number, url: string) => {
			try {
				const envelope = clickEnvelopeFromSteamUrl(String(url ?? ''));
				if (!envelope) {
					dlog(`steam-url: ignored ${String(url).slice(0, 120)}`);
					return;
				}
				dlog(`steam-url: click token=${envelope.token.slice(0, 8)}`);
				void dispatchClick(envelope);
			} catch (e) {
				dlog(`steam-url handler failed: ${(e as Error)?.message ?? e}`);
			}
		});
		dlog(`steam-url: registered steam://${STEAM_URL_SECTION}/${STEAM_URL_RESOURCE}/<payload>`);
		return registration;
	} catch (e) {
		dlog(`steam-url: registration failed: ${(e as Error)?.message ?? e}`);
		return null;
	}
}
