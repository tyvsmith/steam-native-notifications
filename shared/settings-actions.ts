import type * as React from 'react';

/** Both host panels serialize writes and ignore reads started before a write. */
export function useSettingsActions(react: typeof React) {
    const [busy, setBusy] = react.useState(false);
    const [message, setMessage] = react.useState('');
    const [error, setError] = react.useState('');
    const [confirmReset, setConfirmReset] = react.useState(false);
    const active = react.useRef(false);
    const operation = react.useRef(false);
    const generation = react.useRef(0);
    const queuedRead = react.useRef<(() => Promise<void>) | null>(null);
    react.useEffect(() => {
        active.current = true;
        return () => { active.current = false; generation.current++; queuedRead.current = null; };
    }, []);
    const refresh = async <T>(load: () => Promise<T>, apply: (value: T) => void, failed: () => void = () => {}) => {
        if (operation.current) { queuedRead.current = () => refresh(load, apply, failed); return; }
        const current = ++generation.current;
        try {
            const value = await load();
            if (active.current && current === generation.current) apply(value);
        } catch {
            if (active.current && current === generation.current) failed();
        }
    };
    const run = async <T>(action: () => Promise<T>, apply: (value: T) => string) => {
        if (operation.current) return;
        operation.current = true;
        const current = ++generation.current;
        setBusy(true); setMessage(''); setError('');
        try {
            const value = await action();
            if (active.current && current === generation.current) {
                setMessage(apply(value)); setConfirmReset(false);
            }
        } catch (cause) {
            if (active.current && current === generation.current) setError(cause instanceof Error ? cause.message : 'Operation failed');
        } finally {
            operation.current = false;
            if (active.current) {
                setBusy(false);
                const read = queuedRead.current; queuedRead.current = null;
                await read?.();
            }
        }
    };
    return { busy, message, error, confirmReset, setConfirmReset, refresh, run };
}
