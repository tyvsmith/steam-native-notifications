import { ffi } from 'millennium';
import { BUILD_IDENTITY } from '../shared/host';
import { safeJson } from './log';
import { settingsHost } from './settings';

const report = ffi<[string, string], string>('ReportDiagnostic');
let generation = 0;
let active = false;

/** Called through Millennium's plugin export table, in this plugin's isolated world. */
async function handleControl(payload: string): Promise<void> {
    const epoch = generation;
    try {
        const request = JSON.parse(payload);
        const live = () => active && epoch === generation && Number.isSafeInteger(request.deadline) && request.deadline > Date.now();
        if (!live() || typeof request.id !== 'string') return;
        if (request.kind === 'status') {
            let refresh: { settingsRefreshed?: boolean; error?: string } = {};
            if (request.command === 'refresh-settings') {
                try { await settingsHost.read(); refresh = { settingsRefreshed: true }; }
                catch { refresh = { settingsRefreshed: false, error: 'Settings reload failed' }; }
            }
            if (!live()) return;
            const root = globalThis as any;
            await report('status', safeJson({ id: request.id, frontendBuild: BUILD_IDENTITY,
                hook: root.__snnHookState ?? 'unknown', control: typeof root.__snnDevControl === 'function', ...refresh }));
        } else if (request.kind === 'sample' || request.kind === 'dev') {
            const result = await (globalThis as any).__snnDevControl?.(request, request.kind === 'sample');
            if (live()) await report('command', safeJson({ id: request.id, result: result ?? { ok: false, error: 'Frontend control unavailable' } }));
        }
    } catch { /* A failed push leaves the caller unconfirmed. */ }
}

export function startMillenniumDiagnostics(): () => void {
    const epoch = ++generation;
    active = true;
    return () => { if (epoch === generation) { active = false; generation++; } };
}

/** Return before frontend RPC reports back to the backend event loop. */
export function receiveControl(payload: string): void { void handleControl(payload); }
