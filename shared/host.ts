import identity from './build-identity.json';
import { normalizeSettings, validateSettingsPatch, type Platform, type Settings } from './settings';
export const PROTOCOL_VERSION = 1 as const;
export interface BuildIdentity { protocolVersion: typeof PROTOCOL_VERSION; version: string; buildId: string }
/** Deterministic source fingerprint generated before either build. */
export const BUILD_IDENTITY: BuildIdentity = { ...identity, protocolVersion: PROTOCOL_VERSION };
export type HostKind = 'millennium' | 'standalone';
export interface HostCapabilities { settingsWrite: boolean; settingsSubscribe: boolean; notificationCenterOnly: boolean; focusSteam: boolean; developerCommands: boolean }
export function hostCapabilities(kind: HostKind, platform: Platform): HostCapabilities {
    return { settingsWrite: kind === 'millennium', settingsSubscribe: true, notificationCenterOnly: platform === 'windows', focusSteam: kind === 'millennium' && platform === 'windows', developerCommands: true };
}
export interface HostMethods {
    Notify: [string, string, string, string, string, string]; Identity: []; Platform: []; Log: [string];
    GameHostFocus: [number]; TakeDevCommand: []; TakeClick: []; FocusSteam: [string];
}
export type HostMethod = keyof HostMethods;
export interface RuntimeHost { call<M extends HostMethod>(method: M, ...args: HostMethods[M]): Promise<string> }
export type OperationResult<T> = { ok: true; value: T } | { ok: false; code: 'unsupported' | 'invalid' | 'disabled' | 'unavailable'; message: string };
export interface SettingsHost { read(): Promise<Settings>; write(patch: Partial<Settings>): Promise<OperationResult<Settings>>; subscribe(listener: (key: string, value: unknown) => void): () => void }
export interface DiagnosticResult { host: HostKind; build: BuildIdentity; frontendBuild: BuildIdentity | null; capabilities: HostCapabilities; state: string }
export interface DeveloperRequest { id: string; command: string; args: unknown[] }
export interface DeveloperResult { id: string; stage: 'queued' | 'executed' | 'captured' | 'delivery-attempted'; result: OperationResult<unknown> }
export type FfiFactory = <Args extends unknown[], Result>(method: string) => (...args: Args) => Promise<Result>;
export function createRuntimeHost(ffi: FfiFactory): RuntimeHost {
    const methods = new Map<HostMethod, (...args: any[]) => Promise<string>>();
    return { call<M extends HostMethod>(method: M, ...args: HostMethods[M]) {
        let invoke = methods.get(method);
        if (!invoke) { invoke = ffi<HostMethods[M], string>(method); methods.set(method, invoke); }
        return invoke(...args);
    } };
}
export function bindHostMethod<M extends HostMethod>(host: RuntimeHost, method: M): (...args: HostMethods[M]) => Promise<string> {
    return (...args) => host.call(method, ...args);
}
export function parseCallableJson<T>(raw: unknown, fallback: T): T {
    if (typeof raw !== 'string') return (raw as T) ?? fallback;
    try { const once = JSON.parse(raw); return (typeof once === 'string' ? JSON.parse(once) : once) ?? fallback; } catch { return fallback; }
}

export interface SettingsTransport {
    getAll(): Promise<unknown>;
    set?(key: string, value: boolean): Promise<void>;
    subscribe(listener: (key: string, value: unknown) => void): () => void;
}
export function createSettingsHost(transport: SettingsTransport): SettingsHost {
    return {
        async read() { return normalizeSettings(await transport.getAll()); },
        async write(raw) {
            let patch: Partial<Settings>;
            try { patch = validateSettingsPatch(raw); } catch (error) { return { ok: false, code: 'invalid', message: String(error) }; }
            if (!transport.set) return { ok: false, code: 'unsupported', message: 'Settings writes are unavailable through this transport' };
            for (const [key, value] of Object.entries(patch)) await transport.set(key, value);
            return { ok: true, value: normalizeSettings(await transport.getAll()) };
        },
        subscribe: transport.subscribe,
    };
}
