import { appendFile, mkdir, stat, rename, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
export const LOG_LIMIT = 5 * 1024 * 1024;
/** Serialize rotation with appends; diagnostics must never disrupt notification delivery. */
export function rotatingLog(path: string, limit = LOG_LIMIT): (line: string) => Promise<void> {
    let queue = Promise.resolve();
    return line => {
        queue = queue.then(async () => {
            const text = `${new Date().toISOString()} ${line.replace(/[\r\n]/g, ' ').slice(0, 4096)}\n`;
            await mkdir(dirname(path), { recursive:true, mode:0o700 });
            let size = 0; try { size = (await stat(path)).size; } catch (e:any) { if(e.code !== 'ENOENT') throw e; }
            if(size + Buffer.byteLength(text) > limit) { await rename(path, `${path}.1`); await chmod(`${path}.1`, 0o600); }
            await appendFile(path, text, {mode:0o600}); await chmod(path, 0o600);
        }).catch(() => {});
        return queue;
    };
}
