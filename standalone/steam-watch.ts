import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { MARKER } from './marker';

export const FAST_MS = 2000;
// Long enough for a launch that installs a client update before CEF starts.
export const FAST_WINDOW_MS = 300_000;
export const IDLE_MS = 60_000;

/**
 * Paces endpoint inspection. With a launch event available the daemon idles at IDLE_MS
 * and polls at FAST_MS only for FAST_WINDOW_MS after startup, a disconnect or a launch.
 * Without one it keeps the FAST_MS poll.
 */
export class Pacer {
    private fastUntil: number;
    private wakeup?: () => void;
    constructor(private readonly launchEvents: () => boolean, private readonly now = Date.now) { this.fastUntil = now() + FAST_WINDOW_MS; }
    hurry() { this.fastUntil = this.now() + FAST_WINDOW_MS; const wakeup = this.wakeup; this.wakeup = undefined; wakeup?.(); }
    delay() { return !this.launchEvents() || this.now() < this.fastUntil ? FAST_MS : IDLE_MS; }
    wait(): Promise<void> {
        return new Promise(resolve => {
            const timer = setTimeout(() => { this.wakeup = undefined; resolve(); }, this.delay());
            this.wakeup = () => { clearTimeout(timer); resolve(); };
        });
    }
}

type Watch = (path: string, listener: (event: string, filename: string | Buffer | null) => void) => FSWatcher;
export type SteamWatch = { launchEvents: () => boolean; close(): void };

/**
 * steam.sh rewrites ~/.steam/steam.pid on every Linux launch; that is the launch event.
 * The Steam root's own entries carry the marker's deletion. Both are best effort: a missing
 * directory or a watcher error leaves the poll in charge.
 */
export function watchSteam(options: { steam: string; home: string; platform: NodeJS.Platform; onLaunch: () => void; onMarker: () => void; log: (line: string) => void; watcher?: Watch }): SteamWatch {
    const open = options.watcher ?? ((path, listener) => watch(path, { persistent: false }, listener));
    const watchers: FSWatcher[] = [];
    let launchLive = false;
    const start = (path: string, name: string, fire: () => void, onFailure = () => {}) => {
        try {
            const watcher = open(path, (_event, filename) => { if (filename === null || String(filename) === name) fire(); });
            watcher.on('error', (error: any) => { onFailure(); options.log(`standalone: watch: ${path} failed: ${error?.message ?? error}`); watcher.close(); });
            watchers.push(watcher); return true;
        } catch (error: any) { options.log(`standalone: watch: ${path} unavailable: ${error?.message ?? error}`); return false; }
    };
    start(options.steam, MARKER, options.onMarker);
    // Losing the launch watcher wakes the pacer so an idle wait does not outlive it.
    if (options.platform === 'linux') launchLive = start(join(options.home, '.steam'), 'steam.pid', options.onLaunch, () => { launchLive = false; options.onLaunch(); });
    return { launchEvents: () => launchLive, close: () => { for (const watcher of watchers.splice(0)) watcher.close(); } };
}
