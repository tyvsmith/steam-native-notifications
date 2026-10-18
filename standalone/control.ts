import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { setupPaths } from './paths';
import { readFile, writeFile } from 'node:fs/promises';
function windowsPipe() { return '\\\\.\\pipe\\snn-' + createHash('sha256').update(setupPaths().config.toLowerCase()).digest('hex').slice(0, 32); }
function tokenPath() { return join(setupPaths().stateHome, 'steam-native-notifications/control-token'); }
async function controlToken(create = false): Promise<string> {
    if (create) { const { privateDirectory } = await import('./windows'); await privateDirectory(join(tokenPath(), '..')); try { await writeFile(tokenPath(), crypto.randomUUID() + crypto.randomUUID(), { flag: 'wx' }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; } }
    const token = await readFile(tokenPath(), 'utf8'); if (!/^[a-f0-9-]{72}$/.test(token)) throw new Error('Invalid control credential'); return token;
}
export function authenticateControl(value: object, secret: string): string { const { token: _, ...fields } = value as any; return createHmac('sha256', secret).update(JSON.stringify(fields)).digest('hex'); }
export function authenticatedControl(value: object, secret: string): boolean { const tag = (value as any)?.token; return typeof tag === 'string' && /^[a-f0-9]{64}$/.test(tag) && timingSafeEqual(Buffer.from(tag), Buffer.from(authenticateControl(value, secret))); }
import { ownsDaemonLock } from './lock';
import { dlopen, FFIType, ptr } from 'bun:ffi';
import { closeSync } from 'node:fs';
import { createServer, createConnection, type Socket } from 'node:net';
import { mkdir, lstat, chmod, unlink, realpath } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
export const MAX_CONTROL_BYTES = 65536;
export type ControlOperation = 'status' | 'capture' | 'config.read' | 'config.update' | 'config.reset' | 'dev.fire' | 'sample';
const operations = new Set<ControlOperation>(['status', 'capture', 'config.read', 'config.update', 'config.reset', 'dev.fire', 'sample']);
export interface ControlRequest { token?: string; id: string; deadline: number; operation: ControlOperation; payload?: unknown }
export interface ControlReply { token?: string; id: string; ok: boolean; value?: any; error?: string }
export function controlPath(): string {
    if (process.platform === 'win32') return windowsPipe();
    const runtime = process.env.XDG_RUNTIME_DIR;
    if (!runtime || !isAbsolute(runtime)) throw new Error('XDG_RUNTIME_DIR must name an owned absolute runtime directory');
    return join(runtime, 'steam-native-notifications', 'control.sock');
}
async function ownedDirectory(path: string): Promise<void> {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || await realpath(path) !== path) throw new Error('Unsafe control directory');
}
/** Bind an owned fd instead of passing the path to libuv: net.Server.close()
 * otherwise unlinks any replacement at that path before our ownership check. */
function bindOwnedSocket(path: string): number {
    const bytes = Buffer.from(path); if (bytes.length >= 108) throw new Error('Control socket path exceeds Unix limit');
    const libc = dlopen('libc.so.6', {
        socket: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
        bind: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    });
    let fd = -1;
    try {
        fd = libc.symbols.socket(1, 1 | 0x80000 | 0x800, 0); if (fd < 0) throw new Error('Cannot create control socket');
        const address = Buffer.alloc(110); address.writeUInt16LE(1); bytes.copy(address, 2);
        if (libc.symbols.bind(fd, ptr(address), 2 + bytes.length + 1) !== 0) throw new Error('Cannot bind control socket');
        return fd;
    } catch (e) { if (fd >= 0) closeSync(fd); throw e; }
    finally { libc.close(); }
}
async function reclaimStaleSocket(path: string, release?: () => Promise<void>): Promise<void> {
    let candidate;
    try { candidate = await lstat(path); } catch (e: any) { if (e.code === 'ENOENT') return; throw e; }
    if (!ownsDaemonLock(release) || !candidate.isSocket() || candidate.uid !== process.getuid?.() || (candidate.mode & 0o777) !== 0o600) throw new Error('Control socket already exists; refusing to replace it');
    // A connection refusal is evidence of a dead listener; timeout/other failures
    // are inconclusive. Only recover while the daemon's kernel lock is held.
    const stale = await new Promise<boolean>(resolve => {
        const socket = createConnection(path); let settled = false;
        const finish = (value: boolean) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); resolve(value); };
        const timer = setTimeout(() => finish(false), 300);
        socket.on('connect', () => finish(false));
        socket.on('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ECONNREFUSED'));
    });
    if (!stale || !ownsDaemonLock(release)) throw new Error('Control socket is live or its ownership cannot be verified');
    const current = await lstat(path);
    if (!current.isSocket() || current.uid !== candidate.uid || current.mode !== candidate.mode || current.dev !== candidate.dev || current.ino !== candidate.ino) throw new Error('Control socket changed during recovery; refusing replacement');
    await unlink(path);
}
export async function startControl(handler: (request: ControlRequest) => Promise<unknown>, path = controlPath(), options: { exclusiveLock?: () => Promise<void> } = {}): Promise<() => Promise<void>> {
    const windows = process.platform === 'win32';
    const token = windows ? await controlToken(true) : undefined;
    const dir = join(path, '..');
    if (!windows) { await ownedDirectory(join(dir, '..'));
    await mkdir(dir, { mode: 0o700 }).catch((e: any) => { if (e.code !== 'EEXIST') throw e; });
    await ownedDirectory(dir); await chmod(dir, 0o700);
    await reclaimStaleSocket(path, options.exclusiveLock); }
    const sockets = new Set<Socket>(); let active = true; let queue = Promise.resolve();
    const server = createServer(socket => {
        if (sockets.size >= 64) { socket.destroy(); return; }
        sockets.add(socket); socket.setTimeout(12000, () => socket.destroy());
        let buffer = Buffer.alloc(0); let pending = 0;
        socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
        socket.on('data', chunk => {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.length > MAX_CONTROL_BYTES) { socket.destroy(); return; }
            let end: number;
            while ((end = buffer.indexOf(10)) >= 0) {
                const line = buffer.subarray(0, end).toString(); buffer = buffer.subarray(end + 1);
                let request: ControlRequest;
                try {
                    request = JSON.parse(line);
                    if (token && !authenticatedControl(request, token)) throw new Error('Unauthorized control request');
                    if (!request || typeof request.id !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(request.id) || !operations.has(request.operation) || !Number.isSafeInteger(request.deadline) || request.deadline > Date.now() + 10000 || Object.keys(request).some(k => !['id', 'deadline', 'operation', 'payload', ...(windows ? ['token'] : [])].includes(k))) throw new Error('Invalid control request');
                    if (++pending > 16) throw new Error('Too many pending requests');
                } catch { socket.destroy(); return; }
                queue = queue.then(async () => {
                    let reply: ControlReply = { id: request.id, ok: false };
                    try { if (!active || socket.destroyed || request.deadline <= Date.now()) throw new Error('Request expired or disconnected'); reply = { id: request.id, ok: true, value: await handler(request) }; }
                    catch (e: any) { reply.error = e.message; }
                    finally { pending--; }
                    if (token) reply.token = authenticateControl(reply, token);
                    let output = JSON.stringify(reply) + '\n';
                    if (Buffer.byteLength(output) > MAX_CONTROL_BYTES) { const failure: ControlReply = { id: request.id, ok: false, error: 'Control reply too large' }; if (token) failure.token = authenticateControl(failure, token); output = JSON.stringify(failure) + '\n'; }
                    if (!socket.destroyed) socket.write(output);
                }).catch(() => {});
            }
        });
    });
    if (windows) {
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
        return async () => { active = false; for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); };
    }
    const fd = bindOwnedSocket(path);
    try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen({ fd }, resolve); }); }
    catch (e) { closeSync(fd); await unlink(path).catch(() => {}); throw e; }
    await chmod(path, 0o600); const owned = await lstat(path);
    return async () => {
        active = false; for (const socket of sockets) socket.destroy();
        await new Promise<void>(resolve => server.close(() => resolve()));
        try { const current = await lstat(path); if (current.ino === owned.ino && current.dev === owned.dev) await unlink(path); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    };
}
export async function controlCall(operation: ControlOperation, payload?: unknown, options: { path?: string; timeoutMs?: number } = {}): Promise<any> {
    const path = options.path ?? controlPath();
    const token = process.platform === 'win32' ? await controlToken() : undefined;
    if (process.platform !== 'win32') { await ownedDirectory(join(path, '..'));
    const info = await lstat(path);
    if (!info.isSocket() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600 || ((await lstat(join(path, '..'))).mode & 0o777) !== 0o700) throw new Error('Unsafe control socket permissions'); }
    const timeout = Math.min(10000, Math.max(1, options.timeoutMs ?? 7000));
    const request: ControlRequest = { id: crypto.randomUUID(), deadline: Date.now() + timeout, operation, payload };
    if (token) request.token = authenticateControl(request, token);
    const data = JSON.stringify(request) + '\n'; if (Buffer.byteLength(data) > MAX_CONTROL_BYTES) return Promise.reject(new Error('Control request too large'));
    return new Promise((resolve, reject) => {
        const socket = createConnection(path); let buffer = Buffer.alloc(0); let done = false;
        const finish = (error?: Error, value?: unknown) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); };
        const timer = setTimeout(() => finish(new Error('Control request timed out')), timeout);
        socket.on('connect', () => socket.write(data)); socket.on('error', e => finish(e)); socket.on('close', () => finish(new Error('Control connection closed')));
        socket.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); if (buffer.length > MAX_CONTROL_BYTES) return finish(new Error('Control reply too large')); const end = buffer.indexOf(10); if (end < 0) return;
            try { const reply = JSON.parse(buffer.subarray(0, end).toString()) as ControlReply; if (token && !authenticatedControl(reply, token)) throw new Error('Unauthenticated control reply'); if (reply.id !== request.id) throw new Error('Mismatched reply'); finish(reply.ok ? undefined : new Error(reply.error ?? 'Control request failed'), reply.value); } catch (e: any) { finish(e); }
        });
    });
}
