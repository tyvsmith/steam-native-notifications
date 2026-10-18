import { lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
export const UNIT = 'steam-native-notifications-standalone.service';
export type Paths = ReturnType<typeof setupPaths>;
export function setupPaths(env: NodeJS.ProcessEnv = process.env, home = homedir()) {
    const xdg = (key: string, fallback: string) => {
        const value = env[key];
        return value && isAbsolute(value) ? value : join(home, fallback);
    };
    const windows = process.platform === 'win32';
    const local = env.LOCALAPPDATA || join(home, 'AppData/Local');
    const configHome = windows ? local : xdg('XDG_CONFIG_HOME', '.config');
    const stateHome = windows ? local : xdg('XDG_STATE_HOME', '.local/state');
    return { home, configHome, stateHome, dataHome: xdg('XDG_DATA_HOME', '.local/share'),
        cacheHome: windows ? join(local, 'steam-native-notifications/standalone-cache') : xdg('XDG_CACHE_HOME', '.cache'),
        config: join(configHome, 'steam-native-notifications/standalone.json'),
        state: join(stateHome, 'steam-native-notifications/standalone-install.json'),
        unit: join(configHome, 'systemd/user', UNIT),
        autostart: join(configHome, 'autostart/steam-native-notifications-standalone.desktop') };
}
export async function exists(path: string) { try { await lstat(path); return true; } catch (error: any) { if (error.code === 'ENOENT') return false; throw error; } }
export async function discoverSteam(paths: Paths, explicit?: string): Promise<string> {
    if (process.platform === 'win32') {
        const { powershell } = await import('./windows');
        const candidate = explicit ?? await powershell("(Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -ErrorAction Stop).SteamPath");
        const root = await realpath(resolve(candidate));
        if (!await exists(join(root, 'steam.exe'))) throw new Error('Steam.exe not found; select --steam-dir DIR');
        return root;
    }
    const candidates = explicit ? [resolve(explicit)] : [join(paths.home, '.steam/steam'), join(paths.home, '.steam/root'),
        join(paths.dataHome, 'Steam'), join(paths.home, '.local/share/Steam'), join(paths.home, '.steam/debian-installation')];
    const roots = new Set<string>();
    for (const path of candidates) {
        try {
            const root = await realpath(path);
            if (root.includes('/.var/app/') || root.includes('/app/com.valvesoftware.Steam/')) continue;
            if (await exists(join(root, 'steam.sh')) && (await exists(join(root, 'steamrt64/steam')) || await exists(join(root, 'ubuntu12_32/steam')))) roots.add(root);
        } catch { /* missing native candidate */ }
    }
    if (roots.size !== 1) throw new Error(roots.size ? 'Multiple native Steam roots found; select --steam-dir DIR.' : 'Native Steam root not found; select --steam-dir DIR containing steam.sh and the client runtime. Flatpak is unsupported.');
    return [...roots][0]!;
}
