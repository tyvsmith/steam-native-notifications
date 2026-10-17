import { ffi } from 'millennium';
import { BUILD_IDENTITY, parseCallableJson } from '../shared/host';
import { safeJson } from './log';
import { settingsHost } from './settings';

const take = ffi<[], string>('TakeDiagnosticCommand');
const report = ffi<[string, string], string>('ReportDiagnostic');
/** Transport replies are best effort and must never interrupt notification capture. */
export async function reportCommandResult(id: string, result: unknown): Promise<void> {
    try { await report('command', safeJson({ id, result })); } catch { /* caller times out as unconfirmed */ }
}
export function startMillenniumDiagnostics(): () => void {
    let active = true, pending = false;
    const timer = setInterval(async () => {
        if (!active || pending) return;
        pending = true;
        try {
            for (let count = 0; count < 16; count++) {
                const request = parseCallableJson<any>(await take(), null);
                if (!request) break;
                if (!active) return;
                if (typeof request?.id !== 'string' || !Number.isSafeInteger(request.deadline) || request.deadline <= Date.now()) continue;
                let refresh: { settingsRefreshed?: boolean; error?: string } = {};
                if (request.command === 'refresh-settings') {
                    try { await settingsHost.read(); refresh = { settingsRefreshed: true }; }
                    catch { refresh = { settingsRefreshed: false, error: 'Settings reload failed' }; }
                    if (!active || request.deadline <= Date.now()) continue;
                }
                const root = globalThis as any;
                await report('status', safeJson({ id: request.id, frontendBuild: BUILD_IDENTITY,
                    hook: root.__snnHookState ?? 'unknown', control: typeof root.__snnDevControl === 'function', ...refresh }));
            }
        } catch { /* status remains unconfirmed when the bridge is unavailable */ }
        finally { pending = false; }
    }, 1000);
    return () => { active = false; clearInterval(timer); };
}
