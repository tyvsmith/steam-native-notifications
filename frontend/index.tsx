export { receiveControl } from './millennium-diagnostics';
import { startMillenniumDiagnostics } from './millennium-diagnostics';
import { definePlugin, IconsModule } from 'millennium';
import { SettingsPanel } from './SettingsPanel';
import { startNativeNotifications } from './runtime';

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
	const stop = startNativeNotifications();
	const stopDiagnostics = startMillenniumDiagnostics();
	return { title: 'Steam Native Notifications', icon: pluginIcon(), content: <SettingsPanel />, onDismount: () => { stopDiagnostics(); stop(); } } as any;
});
