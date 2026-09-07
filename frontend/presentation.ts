export interface PresentationSettings {
	notifyOutsideGame: boolean;
	notifyInGame: boolean;
	showSteamOutsideGame: boolean;
	showSteamInGame: boolean;
	notificationCenterOnlyOutsideGame: boolean;
	notificationCenterOnlyInGame: boolean;
}

export const PRESENTATION_DEFAULTS: PresentationSettings = {
	notifyOutsideGame: true,
	notifyInGame: true,
	showSteamOutsideGame: false,
	showSteamInGame: true,
	notificationCenterOnlyOutsideGame: false,
	notificationCenterOnlyInGame: false,
};

export type Platform = 'windows' | 'linux' | 'macos' | 'unknown';

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
