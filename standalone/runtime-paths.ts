import { realpathSync } from 'node:fs';
import { dirname, resolve, join, win32 } from 'node:path';

/** Bun compiled modules live in its virtual filesystem; executable names are arbitrary. */
export function resolveRuntimeRoot(moduleDir: string, executable: string): string {
    if (/^\/?\$bunfs(?:[\\/]|$)/.test(moduleDir)) return dirname(realpathSync(executable));
    const paths = /^[A-Za-z]:[\\/]|^\\\\/.test(moduleDir) ? win32 : { resolve };
    return paths.resolve(moduleDir, '..');
}
/** Compiled executables resolve physical version, including stable symlink invocation. */
export function runtimeRoot(): string {
    return resolveRuntimeRoot(import.meta.dir, process.execPath);
}
export const runtimeAsset = (name: string) => join(runtimeRoot(), name);
