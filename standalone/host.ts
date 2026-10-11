import { appendFile, mkdir, readFile, readdir, realpath, unlink, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { PRESENTATION_DEFAULTS } from '../frontend/presentation';
export const CONFIG_DEFAULTS = { ...PRESENTATION_DEFAULTS, devMode: false, devFire: false };
export function configValues(raw: unknown): Record<string, boolean> {
    const values: Record<string, boolean> = { ...CONFIG_DEFAULTS };
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const key of Object.keys(values)) {
            const value = (raw as Record<string, unknown>)[key];
            if (typeof value === 'boolean') values[key] = value;
        }
    }
    return values;
}
export function requestPayload(payload: string): { id: number; method: string; args: unknown[] } {
    if (payload.length > 65536) throw new Error('RPC payload too large');
    const request = JSON.parse(payload);
    if (!Number.isSafeInteger(request?.id) || request.id <= 0 || typeof request.method !== 'string' || !Array.isArray(request.args)) throw new Error('Invalid RPC envelope');
    return request;
}
export class Host {
    private children = new Set<ReturnType<typeof spawn>>();
    private root = resolve(import.meta.dir, '..');
    constructor(readonly runtime: string, readonly config: string, readonly steam: string) {}
    async initialize(): Promise<void> {
        await mkdir(this.runtime, { recursive: true, mode: 0o700 });
        // Separate log: a standalone daemon must not truncate Millennium's evidence.
        await this.log('standalone: backend started (experimental linux RT3)');
    }
    async log(line: string): Promise<void> {
        await appendFile(join(this.runtime, 'standalone.log'), `${new Date().toISOString()} ${line.replace(/[\r\n]/g, ' ').slice(0, 4096)}\n`, { mode: 0o600 });
    }
    async readiness(state: string): Promise<void> {
        const path = join(this.runtime, 'standalone-status.json');
        await writeFile(path + '.tmp', JSON.stringify({ state, pid: process.pid, at: Date.now(), steam: this.steam }), { mode: 0o600 });
        await rename(path + '.tmp', path);
    }
    async settings(): Promise<Record<string, boolean>> {
        try { return configValues(JSON.parse(await readFile(this.config, 'utf8'))); }
        catch (error: any) {
            if (error.code !== 'ENOENT') await this.log(`standalone: invalid settings; safe defaults: ${error.message}`);
            return configValues({});
        }
    }
    private async consume(name: string): Promise<string> {
        try { const path = join(this.runtime, name); const value = await readFile(path, 'utf8'); await unlink(path); return value; }
        catch { return ''; }
    }
    async dispatch(method: string, args: unknown[]): Promise<string> {
        switch (method) {
            case 'Health': if (args.length) break; return 'ok';
            case 'Platform': if (args.length) break; return 'linux';
            case 'Log': if (args.length !== 1 || typeof args[0] !== 'string') break; await this.log(args[0]); return 'ok';
            case 'Identity': {
                if (args.length) break;
                try {
                    const text = await readFile(join(this.steam, 'config/loginusers.vdf'), 'utf8');
                    const records = [...text.matchAll(/"(7656119\d{10})"\s*\{([^{}]*)\}/g)];
                    const recent = records.find(record => /"MostRecent"\s*"1"/i.test(record[2]!));
                    return JSON.stringify({ steamid64: recent?.[1] ?? (records.length === 1 ? records[0]?.[1] : undefined) });
                } catch { return '{}'; }
            }
            case 'FocusSteam': return 'unsupported'; // Linux focus is performed inside Steam's existing dispatcher.
            case 'TakeClick': if (args.length) break; return this.consume('.click');
            case 'TakeDevCommand': if (args.length) break; return (await this.settings()).devFire ? this.consume('.dev-fire') : '';
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
