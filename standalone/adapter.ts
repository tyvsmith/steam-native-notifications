/** Browser-only compatibility seam; no Millennium runtime or settings panel. */
type Pending = { resolve(value: string): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<number, Pending>();
let sequence = 0;
const listeners = new Set<(key: string, value: unknown) => void>();
let config: Record<string, unknown> = (globalThis as any).__snnInitialConfig ?? {};
const bridge = globalThis as typeof globalThis & {
    __snnHost(payload: string): void;
    __snnReply(id: number, value: string, error?: string): void;
    __snnConfig(values: Record<string, unknown>): void;
};
bridge.__snnReply = (id, value, error) => {
    const request = pending.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(id);
    if (error) request.reject(new Error(error)); else request.resolve(value);
};
bridge.__snnConfig = (values) => {
    const keys = new Set([...Object.keys(config), ...Object.keys(values)]);
    config = values;
    for (const key of keys) for (const listener of listeners) listener(key, config[key]);
};
export function ffi<Args extends unknown[], Result>(method: string): (...args: Args) => Promise<Result> {
    return (...args) => new Promise<string>((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} host timeout`)); }, 5000);
        pending.set(id, { resolve, reject, timer });
        try { bridge.__snnHost(JSON.stringify({ id, method, args })); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    }).then(value => value as Result);
}
export const pluginConfig = { async getAll<T>() { return config as T; } };
export function subscribePluginConfig(listener: (key: string, value: unknown) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Steam's current webpack runtime hides require.c. Resolve only factories with
 * the known store signatures used by our two frontend callers, then inspect exports.
 * Unlike the full SDK, this never eagerly requires the entire module table.
 */
export function findModuleExport(predicate: (value: any) => boolean): any {
    const chunks = (globalThis as any).webpackChunksteamui;
    if (!Array.isArray(chunks)) return undefined;
    let requireModule: any;
    chunks.push([[`snn-${Date.now()}-${Math.random()}`], {}, (require: any) => { requireModule = require; }]);
    if (typeof requireModule !== 'function') return undefined;
    const source = String(predicate);
    const signatures = ['OnGameOverlayActivateRequested', 'OnServerNotification'].filter(name => source.includes(name));
    if (!signatures.length) return undefined;
    for (const [id, factory] of Object.entries(requireModule.m ?? {})) {
        if (!signatures.some(name => String(factory).includes(name))) continue;
        try {
            const exports = requireModule(id);
            const candidates = [exports];
            if (exports && (typeof exports === 'object' || typeof exports === 'function')) {
                for (const name of Object.keys(exports)) {
                    try { candidates.push(exports[name]); } catch { /* lazy getter unavailable */ }
                }
            }
            for (const candidate of candidates) {
                try { if (predicate(candidate)) return candidate; } catch { /* next export */ }
            }
        } catch { /* optional store unavailable */ }
    }
    return undefined;
}
