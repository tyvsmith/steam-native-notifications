import { startNativeNotifications } from '../frontend/runtime';
const root: any = globalThis;
// Daemon reattachment must not register duplicate hooks in an existing context.
if (!root.__snnStandaloneStarted) {
    root.__snnStandaloneStop = startNativeNotifications();
    root.__snnStandaloneStarted = true;
}
