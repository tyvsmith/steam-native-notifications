import { closeSync, openSync, writeFileSync, constants, fstatSync } from 'node:fs';
import { join } from 'node:path';
import { dlopen, FFIType } from 'bun:ffi';
const daemonLocks = new WeakSet<() => Promise<void>>();
export function ownsDaemonLock(release: (() => Promise<void>) | undefined): boolean { return !!release && daemonLocks.has(release); }
/** Kernel lock survives neither exit nor crash; never delete the lock inode.
 * O_CLOEXEC prevents notification helpers inheriting daemon ownership. */
export async function acquireDaemonLock(runtime: string): Promise<() => Promise<void>> {
    const libc = dlopen('libc.so.6', { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
    const fd = openSync(join(runtime, '.standalone-daemon.flock'), constants.O_CREAT | constants.O_RDWR, 0o600);
    if (libc.symbols.flock(fd, 6) !== 0) {
        closeSync(fd); libc.close();
        throw new Error('Another standalone daemon holds the runtime lock; stop it before starting this daemon.');
    }
    writeFileSync(fd, String(process.pid));
    const release = async () => { if (!daemonLocks.delete(release)) return; closeSync(fd); libc.close(); };
    daemonLocks.add(release);
    return release;
}

/** Bounded cross-process settings lock, released by the kernel after a crash. */
export async function acquireConfigLock(path: string, timeoutMs = 2500): Promise<() => void> {
    const libc = dlopen('libc.so.6', { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
    let fd: number;
    try { fd = openSync(path + '.lock', constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | 0x80000, 0o600); }
    catch (e) { libc.close(); throw e; }
    const info = fstatSync(fd);
    if (!info.isFile() || info.uid !== process.getuid?.()) { closeSync(fd); libc.close(); throw new Error('Unsafe configuration lock file'); }
    const until = Date.now() + timeoutMs;
    while (libc.symbols.flock(fd, 6) !== 0) {
        if (Date.now() >= until) { closeSync(fd); libc.close(); throw new Error('Configuration is locked by another writer; retry shortly'); }
        await Bun.sleep(15);
    }
    return () => { closeSync(fd); libc.close(); };
}
