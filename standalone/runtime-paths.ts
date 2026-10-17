import { resolve, join, win32 } from 'node:path';

/** Source and bundled CLI both live directly under standalone/. */
export function resolveRuntimeRoot(moduleDir: string): string {
    const paths = /^[A-Za-z]:[\\/]|^\\\\/.test(moduleDir) ? win32 : { resolve };
    return paths.resolve(moduleDir, '..');
}
export const runtimeRoot = () => resolveRuntimeRoot(import.meta.dir);
export const runtimeAsset = (name: string) => join(runtimeRoot(), name);
