import { loginUser } from './login-user';
import { controlHandler } from './control-host';
import { preferencePatch, preferenceDefaults } from '../shared/settings-policy';
import { runtimeRoot } from './runtime-paths';
import { configStore, type ConfigStore } from './config-store';
import { rotatingLog } from './log';
import { mkdir, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { DEFAULTS, normalizeSettings } from '../shared/settings';
import { BUILD_IDENTITY } from '../shared/host';
export const CONFIG_DEFAULTS = DEFAULTS;
export const configValues = normalizeSettings;
export function requestPayload(payload: string): { id: number; method: string; args: unknown[] } {
    if (payload.length > 65536) throw new Error('RPC payload too large');
    const request = JSON.parse(payload);
    if (!Number.isSafeInteger(request?.id) || request.id <= 0 || typeof request.method !== 'string' || !Array.isArray(request.args)) throw new Error('Invalid RPC envelope');
    return request;
}
export class Host {
    private children = new Set<ReturnType<typeof spawn>>();
    private root = runtimeRoot();
    readonly store: ConfigStore;
    live: any = { state: 'disconnected', frontendBuild: null, hook: 'unknown' };
    removal?: { remove(): Promise<unknown>; acknowledged(): void };
    frontendCommand?: (envelope: any, sample: boolean) => Promise<unknown>;
    readonly logPath: string;
    private writeLog: (line: string) => Promise<void>;
    constructor(readonly runtime: string, readonly config: string, readonly steam: string, logDirectory = runtime) { this.store = configStore(config); this.logPath = join(logDirectory, 'standalone.log'); this.writeLog = rotatingLog(this.logPath); }
    async initialize(): Promise<void> {
        await mkdir(this.runtime, { recursive: true, mode: 0o700 });
        // Separate log: a standalone daemon must not truncate Millennium's evidence.
        await this.log('standalone: backend started (experimental linux RT3)');
    }
    async log(line: string): Promise<void> { await this.writeLog(line); }
    async readiness(state: string): Promise<void> {
        this.live.state = state;

    }
    async settings(): Promise<Record<string, boolean>> { return (await this.store.read()).values; }
    private async consume(name: string): Promise<string> {
        try { const path = join(this.runtime, name); const value = await readFile(path, 'utf8'); await unlink(path); return value; }
        catch { return ''; }
    }
    async dispatch(method: string, args: unknown[]): Promise<string> {
        switch (method) {
            case 'PanelRemove':
                if (args.length || !this.removal) break;
                return JSON.stringify(await this.removal.remove());
            case 'PanelRead':
                if (args.length) break;
                return JSON.stringify({ config: await this.store.read(), state: this.live.state,
                    compatible: this.live.frontendBuild?.buildId === BUILD_IDENTITY.buildId && this.live.control === true,
                    hook: this.live.hook, build: BUILD_IDENTITY });
            case 'PanelPatch':
                if (args.length !== 1) break;
                return JSON.stringify(await this.store.update(preferencePatch(args[0], (await this.store.read()).values, 'linux'), Date.now() + 4000));
            case 'PanelReset':
                if (args.length) break;
                return JSON.stringify(await this.store.update(preferenceDefaults('linux'), Date.now() + 4000));
            case 'PanelSample':
                if (args.length) break;
                return JSON.stringify(await controlHandler(this)({ id: crypto.randomUUID(), operation: 'sample', deadline: Date.now() + 4000 }));
            case 'Health': if (args.length) break; return 'ok';
            case 'Platform': if (args.length) break; return 'linux';
            case 'Log': if (args.length !== 1 || typeof args[0] !== 'string') break; await this.log(args[0]); return 'ok';
            case 'Identity': {
                if (args.length) break;
                try {
                    const text = await readFile(join(this.steam, 'config/loginusers.vdf'), 'utf8');
                    return JSON.stringify({ steamid64: loginUser(text) });
                } catch { return '{}'; }
            }
            case 'FocusSteam': return 'unsupported'; // Linux focus is performed inside Steam's existing dispatcher.
            case 'TakeSampleCommand': if (args.length) break; return ''; // samples arrive through private control
            case 'TakeClick': if (args.length) break; return this.consume('.click');
            case 'TakeDevCommand': if (args.length) break; return ''; // Millennium owns .dev-fire; standalone uses private control exclusively.
            case 'GameHostFocus': {
                const appid = args[0];
                if (args.length !== 1 || typeof appid !== 'number' || !Number.isInteger(appid) || appid <= 0 || appid > 0xffffffff) return 'unknown';
                return this.focus(appid);
            }
            case 'Notify': {
                if (args.length !== 6 || args.some(value => typeof value !== 'string' || value.length > 16384)) break;
                if (!Bun.which('notify-send', { PATH: process.env.PATH }) || !Bun.which('gdbus', { PATH: process.env.PATH }) || this.children.size >= 64) return 'unsupported';
                const strings = args as string[];
                return new Promise(resolveResult => {
                    // argv only; rendered Steam text cannot become shell source.
                    const child = spawn('sh', [join(this.root, 'tools/notify-action'), ...strings.slice(0, 5)], {
                        stdio: 'ignore', env: { ...process.env, XDG_CACHE_HOME: resolve(this.runtime, '..'), SNN_STEAM_DIR: this.steam, LD_LIBRARY_PATH: '', LD_PRELOAD: '' },
                    });
                    this.children.add(child);
                    child.once('error', () => { this.children.delete(child); resolveResult('unsupported'); });
                    child.once('spawn', () => resolveResult('ok'));
                    child.once('exit', () => this.children.delete(child));
                });
            }
        }
        throw new Error(`Unsupported method or invalid arguments: ${method}`);
    }
    private async focus(appid: number): Promise<string> {
        if (!Bun.which('luajit', { PATH: process.env.PATH })) return 'unknown';
        try {
            const entries = await readdir('/proc');
            const paths = await Promise.all(entries.filter(id => /^\d+$/.test(id)).map(async id => {
                try { return `${id}|${await realpath(`/proc/${id}/exe`)}`; } catch { return `${id}|`; }
            }));
            const child = Bun.spawn(['luajit', join(this.root, 'standalone/focus.lua'), String(appid)], {
                cwd: this.root, stdin: new Blob([paths.join('\n')]), stdout: 'pipe', stderr: 'ignore',
            });
            const timeout = setTimeout(() => child.kill(), 1200);
            try {
                const output = (await new Response(child.stdout).text()).trim();
                return await child.exited === 0 && ['game', 'desktop'].includes(output) ? output : 'unknown';
            } finally { clearTimeout(timeout); }
        } catch { return 'unknown'; }
    }
    stop(): void { for (const child of this.children) child.kill(); }
}
