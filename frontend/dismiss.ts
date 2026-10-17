import { firstFiber } from './fiber';

/** Capture Steam's bound dismissal inside this toast's portal, never its click action. */
export function toastDismissal(win: Window): (() => void) | null {
    try {
        const doc = win.document;
        const id = /^notificationtoasts_(.+)_desktop$/.exec(win.name)?.[1]
            ?? /^notificationtoasts_uid\d+-(.+)$/.exec(win.name)?.[1];
        if (!id) return null;
        let fiber = firstFiber(doc);
        let dismiss: (() => void) | null = null;
        let notification: unknown;
        for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
            if (fiber.tag === 4) {
                return fiber.stateNode?.containerInfo?.ownerDocument === doc ? dismiss : null;
            }
            const props = fiber.memoizedProps;
            if (typeof props?.onDismiss !== 'function' || !props.notification) continue;
            const value = props.notification;
            if (value.notificationID === undefined || String(value.notificationID) !== id) return null;
            if (dismiss && (dismiss !== props.onDismiss || notification !== value)) return null;
            dismiss = props.onDismiss;
            notification = value;
        }
    } catch { /* Unrecognized React trees preserve Steam's notification. */ }
    return null;
}
