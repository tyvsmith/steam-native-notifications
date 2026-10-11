import { realpathSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
/** Compiled executables resolve physical version, including stable symlink invocation. */
export function runtimeRoot(): string {
    return process.execPath.endsWith('/bun') ? resolve(import.meta.dir, '..') : dirname(realpathSync(process.execPath));
}
export const runtimeAsset = (name: string) => join(runtimeRoot(), name);
