import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exists } from './paths';

export const MARKER = '.cef-enable-remote-debugging';
export const MARKER_ACTION = 'Steam removed its CEF debugging marker (Steam client updates have done this); it was recreated. If Steam is running, fully exit and relaunch it.';

/** Steam client updates can delete the marker setup created. Restore it only for the installed integration's own Steam root. */
export async function restoreMarker(statePath: string, steam: string): Promise<'restored' | 'present' | 'unowned'> {
    const marker = join(steam, MARKER);
    if (await exists(marker)) return 'present';
    let owned: unknown;
    try { owned = JSON.parse(await readFile(statePath, 'utf8'))?.steam; } catch { return 'unowned'; }
    if (owned !== steam) return 'unowned';
    try { await writeFile(marker, '', { flag: 'wx', mode: 0o600 }); }
    catch (error: any) { if (error.code === 'EEXIST') return 'present'; throw error; }
    return 'restored';
}
