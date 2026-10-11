import type { PresentationSettings, Platform } from '../shared/settings';
export { PRESENTATION_DEFAULTS } from '../shared/settings';
export type { PresentationSettings, Platform } from '../shared/settings';

/** Presentation follows Steam's capture surface, which can lag after alt-tab. */
export function presentationFor(settings: PresentationSettings, captureAppId: number | null, platform: Platform) {
	if (captureAppId === null) return { sendNative: false, showSteam: true, suppressPopup: false };
	const inGame = captureAppId > 0;
	const sendNative = inGame ? settings.notifyInGame : settings.notifyOutsideGame;
	return {
		sendNative,
		showSteam: inGame ? settings.showSteamInGame : settings.showSteamOutsideGame,
		suppressPopup: sendNative && platform === 'windows' &&
			(inGame ? settings.notificationCenterOnlyInGame : settings.notificationCenterOnlyOutsideGame),
	};
}
