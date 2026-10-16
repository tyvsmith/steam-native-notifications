import { startSteamPanel } from './steam-panel';
import { startNativeNotifications } from '../frontend/runtime';
import { BUILD_IDENTITY } from '../shared/host';
const root: any = globalThis;
root.__snnFrontendBuild = BUILD_IDENTITY;
// Daemon reattachment must not register duplicate hooks in an existing context.
if (!root.__snnStandaloneStarted) {
    root.__snnStandaloneStop = startNativeNotifications();
    root.__snnStandaloneStarted = true;
    root.__snnPanelStop = startSteamPanel();
}
