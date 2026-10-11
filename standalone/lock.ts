import { closeSync, openSync, writeFileSync, constants } from 'node:fs';
import { join } from 'node:path';
import { dlopen, FFIType } from 'bun:ffi';
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
    return async () => { closeSync(fd); libc.close(); };
}
