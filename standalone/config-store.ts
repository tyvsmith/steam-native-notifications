import { acquireConfigLock } from './lock';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULTS, isSettingKey, normalizeSettings, validateSettingsPatch, type Settings } from '../shared/settings';
export function configPath(): string { return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'steam-native-notifications/standalone.json'); }
export interface ConfigSnapshot { values: Settings; error: string | null }
/** One shared store per path serializes local writers. Invalid external edits retain last good values. */
export class ConfigStore {
    private raw: Record<string, unknown> = {};
    private queue: Promise<unknown> = Promise.resolve();
    constructor(readonly path: string) {}
    async read(): Promise<ConfigSnapshot> {
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
            const current = await this.read();
            if (current.error) throw new Error(`${current.error}; repair the file before writing`);
            const next = { ...this.raw, ...patch };
            const temp = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
            try { await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); if (deadline <= Date.now()) throw new Error('Configuration request expired'); await rename(temp, this.path); }
            finally { await unlink(temp).catch(() => {}); }
            this.raw = next;
            return { values: normalizeSettings(next), error: null };
            } finally { release(); }
        });
        this.queue = operation.catch(() => {});
        return operation;
    }
    reset(deadline = Infinity): Promise<ConfigSnapshot> { return this.update(DEFAULTS, deadline); }
}
const stores = new Map<string, ConfigStore>();
export function configStore(path = configPath()): ConfigStore { let store = stores.get(path); if (!store) { store = new ConfigStore(path); stores.set(path, store); } return store; }
