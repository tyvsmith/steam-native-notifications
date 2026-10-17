import { acquireConfigLock } from './lock';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { setupPaths } from './paths';
import { DEFAULTS, isSettingKey, normalizeSettings, validateSettingsPatch, type Settings } from '../shared/settings';
export function configPath(): string { return setupPaths().config; }
export interface ConfigSnapshot { values: Settings; error: string | null }
/** One shared store per path serializes local writers. Invalid external edits retain last good values. */
export class ConfigStore {
    private raw: Record<string, unknown> = {};
    private queue: Promise<unknown> = Promise.resolve();
    private listeners = new Set<(snapshot: ConfigSnapshot) => void>();
    private watcher?: FSWatcher;
    private watchRetry?: ReturnType<typeof setTimeout>;
    private published = '';
    private watchError: string | null = null;
    constructor(readonly path: string) {}
    private publish(snapshot: ConfigSnapshot): void {
        const encoded = JSON.stringify(snapshot);
        if (encoded === this.published) return;
        this.published = encoded;
        for (const listener of this.listeners) { try { listener(snapshot); } catch {} }
    }
    async subscribe(listener: (snapshot: ConfigSnapshot) => void): Promise<() => void> {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        this.listeners.add(listener);
        this.startWatch();
        return () => {
            this.listeners.delete(listener);
            if (!this.listeners.size) { this.watcher?.close(); this.watcher = undefined; if (this.watchRetry) clearTimeout(this.watchRetry); this.watchRetry = undefined; }
        };
    }
    private startWatch(): void {
        if (this.watcher) return;
        const failed = (error: Error) => {
            this.watcher?.close(); this.watcher = undefined;
            this.watchError = `Configuration watch unavailable: ${error.message}`;
            this.publish({ values: normalizeSettings(this.raw), error: this.watchError });
            if (this.listeners.size && !this.watchRetry) this.watchRetry = setTimeout(() => {
                this.watchRetry = undefined;
                this.startWatch();
                if (this.watcher) void this.read().then(snapshot => this.publish(snapshot));
            }, 1000);
        };
        try {
            this.watcher = watch(dirname(this.path), (_event, filename) => {
                if (filename !== null && String(filename) !== basename(this.path)) return;
                void this.read().then(snapshot => this.publish(snapshot)).catch(failed);
            });
            this.watcher.on('error', failed);
            this.watchError = null;
        } catch (error) { failed(error as Error); }
    }
    read(): Promise<ConfigSnapshot> {
        const operation = this.queue.then(async () => { const snapshot = await this.load(); return this.watchError ? { ...snapshot, error: this.watchError } : snapshot; });
        this.queue = operation.catch(() => {});
        return operation;
    }
    private async load(): Promise<ConfigSnapshot> {
        try {
            const parsed = JSON.parse(await readFile(this.path, 'utf8'));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Configuration must be an object');
            for (const [key, value] of Object.entries(parsed)) if (isSettingKey(key) && typeof value !== 'boolean') throw new Error(`Invalid boolean: ${key}`);
            this.raw = parsed;
            return { values: normalizeSettings(this.raw), error: null };
        } catch (e: any) {
            if (e.code === 'ENOENT') { this.raw = {}; return { values: normalizeSettings({}), error: null }; }
            return { values: normalizeSettings(this.raw), error: `Invalid configuration: ${e.message}` };
        }
    }
    update(input: unknown, deadline = Infinity): Promise<ConfigSnapshot> {
        const patch = validateSettingsPatch(input);
        const operation: Promise<ConfigSnapshot> = this.queue.then(async (): Promise<ConfigSnapshot> => {
            await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
            const release = await acquireConfigLock(this.path);
            try {
            if (deadline <= Date.now()) throw new Error('Configuration request expired');
            const current = await this.load();
            if (current.error) throw new Error(`${current.error}; repair the file before writing`);
            const next = { ...this.raw, ...patch };
            const temp = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
            try { await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); if (deadline <= Date.now()) throw new Error('Configuration request expired'); await rename(temp, this.path); }
            finally { await unlink(temp).catch(() => {}); }
            this.raw = next;
            const snapshot: ConfigSnapshot = { values: normalizeSettings(next), error: null };
            this.publish(snapshot);
            return snapshot;
            } finally { release(); }
        });
        this.queue = operation.catch(() => {});
        return operation;
    }
    reset(deadline = Infinity): Promise<ConfigSnapshot> { return this.update(DEFAULTS, deadline); }
}
const stores = new Map<string, ConfigStore>();
export function configStore(path = configPath()): ConfigStore { let store = stores.get(path); if (!store) { store = new ConfigStore(path); stores.set(path, store); } return store; }
