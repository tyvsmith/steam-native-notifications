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

/**
 * The daemon's repair step. `advise` is true only when Steam has no debug listener: a listening
 * Steam keeps its endpoint and only the next launch needs the marker. Failures never throw, so
 * they cannot displace the endpoint diagnostic, and each distinct failure is logged once.
 */
export function markerRepairer(options: { statePath: string; steam: string; log: (line: string) => Promise<void> | void; advise: (action: string) => void }) {
    let failure = '';
    return async (advise: boolean) => {
        let result;
        try { result = await restoreMarker(options.statePath, options.steam); failure = ''; }
        catch (error: any) {
            const message = String(error?.message ?? error);
            if (message !== failure) { failure = message; await options.log(`standalone: marker: repair failed: ${message}`); }
            return;
        }
        if (result !== 'restored') return;
        if (advise) options.advise(MARKER_ACTION);
        await options.log(`standalone: marker: recreated ${join(options.steam, MARKER)}; ${advise ? 'Steam restart required' : 'next Steam launch uses it'}`);
    };
}
