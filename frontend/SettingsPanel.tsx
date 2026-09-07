import { useEffect, useState } from 'react';
import { DialogBodyText, DialogControlsSection, DialogControlsSectionHeader, ToggleField, usePluginConfig } from 'millennium';
import { DEFAULTS, type Settings } from './settings';
import { loadPlatform } from './platform';
import type { Platform } from './presentation';

function useToggle(key: keyof Settings): [boolean, (value: boolean) => void] {
	const [value, setValue] = usePluginConfig<boolean>(key);
	return [typeof value === 'boolean' ? value : DEFAULTS[key], (next) => void setValue(next)];
}

function PresentationSection({ inGame, windows }: { inGame: boolean; windows: boolean }) {
	const [native, setNative] = useToggle(inGame ? 'notifyInGame' : 'notifyOutsideGame');
	const [steam, setSteam] = useToggle(inGame ? 'showSteamInGame' : 'showSteamOutsideGame');
	const [history, setHistory] = useToggle(inGame ? 'notificationCenterOnlyInGame' : 'notificationCenterOnlyOutsideGame');
	return (
		<DialogControlsSection>
			<DialogControlsSectionHeader>{inGame ? 'Inside games' : 'Outside games'}</DialogControlsSectionHeader>
			<DialogBodyText>{inGame
				? 'For notifications Steam sends to the game overlay. This can continue after alt-tabbing.'
				: 'For notifications Steam sends to the desktop.'}</DialogBodyText>
			<ToggleField label="Show OS notifications"
				description="Send a copy to your operating system. Banners follow your system notification settings."
				checked={native} onChange={setNative} />
			<ToggleField label="Show Steam notifications"
				description="Keep Steam's own notification toast visible."
				checked={steam} onChange={setSteam} />
			{windows && native && <ToggleField label="Save to Notification Center only"
				description="Save notifications without showing a Windows banner, even when Do Not Disturb is off."
				checked={history} onChange={setHistory} />}
			{!native && !steam && <DialogBodyText>Notifications are off for this context</DialogBodyText>}
		</DialogControlsSection>
	);
}

export function SettingsPanel() {
	const [platform, setPlatform] = useState<Platform>('unknown');
	const [devFire, setDevFire] = useToggle('devFire');
	const [devMode] = useToggle('devMode');
	useEffect(() => {
		let mounted = true;
		void loadPlatform().then((value) => { if (mounted) setPlatform(value); });
		return () => { mounted = false; };
	}, []);
	return (
		<>
			<PresentationSection inGame={false} windows={platform === 'windows'} />
			<PresentationSection inGame={true} windows={platform === 'windows'} />
			{devMode && <DialogControlsSection>
				<DialogControlsSectionHeader>Developer options</DialogControlsSectionHeader>
				<ToggleField label="Developer: accept test commands from tools/fire"
					description="Lets the tools/fire script in the plugin repository push synthesized notifications through Steam's own pipeline."
					checked={devFire} onChange={setDevFire} />
			</DialogControlsSection>}
		</>
	);
}
