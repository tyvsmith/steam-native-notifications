// Shared plumbing for the dev tools (tools/fire, tools/capture, tools/mep):
// the plugin's identity, where its runtime state and the installed .star live
// on each platform, how to read plugin.log, how to write the dev door, and
// the log-prefix contract from frontend/log.ts. backend/main.lua computes the
// same paths; a change there is a change here.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** millennium.toml [plugin] id; also the AppUserModelId Windows records toasts under. */
export const PLUGIN_ID = 'me.tysmith.steam-native-notifications';

export const IS_WINDOWS = process.platform === 'win32';

/** The environment a path rule reads; `process.env` in every caller but the tests. */
export type Env = Record<string, string | undefined>;

// The frontend's verdict on its notification hook, written once per real
// start, so the newest one dates the running frontend.
const HOOK = /hook installed|hook failed|g_PopupManager never appeared/;

// The startup-phase lines every producer writes: the frontend's hook verdict
// and steam:// registration, and the backend's verdict on the delivery helper
// it materializes at load. Each helper alternative quotes its producer rather
// than matching the bare word, so the per-click `focus: helper failed:` line
// tools/notify-action.ps1 writes stays in the notification section where it
// belongs.
const STARTUP = [
	HOOK.source,
	'helper: ', // backend/main.lua:523, the installed path
	'helper install FAILED', // backend/main.lua:525
	'helper -Setup could not run', // backend/main.lua:532
	'CreateProcessW failed for the Windows helper', // backend/main.lua:225
	'notifications will not be delivered', // backend/main.lua:519, the macOS verdict
	'steam-url: registered', // frontend/steamurl.ts:57
].join('|');

// What one notification did, from the frontend's read of Steam's toast to the
// platform's answer: the delivery path, the click path, and every way either
// end reports a notification it could not deliver.
const NOTIFICATION = [
	'from-toast ', // frontend/index.tsx:170
	'toast .* -> ', // frontend/index.tsx:210
	'left open: ', // frontend/index.tsx:218 and :133
	'could not close ', // frontend/index.tsx:224
	'dev-fire',
	'replay: candidates',
	'replay: invoke',
	'click-bridge',
	'steam-url: click',
	'steam-url: ignored',
	'focus:', // frontend/clickbridge.ts and tools/notify-action.ps1:336, :339
	'notification dropped', // backend/main.lua:258, :268, :281 and tools/notify-action.ps1:115
	'toast delivery failed:', // tools/notify-action.ps1:381
	'notification platform unavailable', // tools/notify-action.ps1:379
	'delivery suppressed during platform back-off', // tools/notify-action.ps1:129
].join('|');

/**
 * The prefixes the tools read. frontend/log.ts owns the vocabulary and these
 * patterns mirror it, with the lines backend/main.lua and
 * tools/notify-action.ps1 write on the same surfaces. Case-sensitive
 * throughout: a renamed prefix must read as "nothing logged", never as a
 * stale answer.
 */
export const LOG = {
	hook: HOOK,
	startup: new RegExp(STARTUP),
	notification: new RegExp(NOTIFICATION),
} as const;

/**
 * An XDG base directory, honouring the spec's rule that a variable set to the
 * empty string counts as unset, the way `${XDG_CACHE_HOME:-$HOME/.cache}`
 * reads it in a shell.
 */
function xdgDir(env: Env, name: string, fallback: string): string {
	const value = env[name];
	return value !== undefined && value !== '' ? value : fallback;
}

/** %LOCALAPPDATA%: the base of every per-user runtime path on Windows. */
export function localAppData(): string {
	return localAppDataFrom(process.env, homedir());
}

function localAppDataFrom(env: Env, home: string): string {
	return env.LOCALAPPDATA ?? join(env.USERPROFILE ?? home, 'AppData', 'Local');
}

/**
 * Where every runtime file lives: the packed .star has no plugin directory,
 * so the backend materializes its helper here, mirrors its log here, and
 * reads the dev door here (backend/main.lua runtime_dir).
 */
export function runtimeDir(): string {
	return runtimeDirFor(process.platform, process.env, homedir());
}

/** runtimeDir's rule, one argument per thing it reads, so every platform's branch is testable on one machine. */
export function runtimeDirFor(platform: NodeJS.Platform, env: Env, home: string): string {
	if (platform === 'win32') return join(localAppDataFrom(env, home), 'steam-native-notifications');
	if (platform === 'darwin') return join(home, 'Library', 'Caches', 'steam-native-notifications');
	return join(xdgDir(env, 'XDG_CACHE_HOME', join(home, '.cache')), 'steam-native-notifications');
}

export function pluginLogPath(): string {
	return join(runtimeDir(), 'plugin.log');
}

/**
 * Millennium's external protocol socket: /tmp on POSIX, the user's temp
 * directory on Windows (Millennium: src/include/mep/mep_server.h).
 */
export function mepSocketPath(): string {
	return IS_WINDOWS ? join(tmpdir(), 'millennium-mep.sock') : '/tmp/millennium-mep.sock';
}

/**
 * The Steam directory the backend published at its last load
 * (backend/main.lua publish_steam_dir): rewritten every load, removed when
 * Millennium had no answer. The authoritative path, and proof the backend
 * has loaded at least once. Null when absent or empty, never a throw.
 */
function publishedSteamDir(): string | null {
	let dir: string;
	try {
		dir = readFileSync(join(runtimeDir(), 'steam-dir'), 'utf8').trim().replace(/[/\\]+$/, '');
	} catch {
		// Absent, or removed by a backend load between one moment and the next.
		return null;
	}
	return dir !== '' && existsSync(dir) ? dir : null;
}

let steamDirCache: string | null | undefined;

/**
 * Where Steam is: the published path first, then the platform's own answer
 * (the registry on Windows, the install locations elsewhere). Null rather
 * than a guess, so a tool never reports on a Steam that is not the one
 * running. Found once per run: the registry probe spawns a process per key.
 */
export function steamDir(): string | null {
	if (steamDirCache === undefined) steamDirCache = findSteamDir();
	return steamDirCache;
}

function findSteamDir(): string | null {
	const published = publishedSteamDir();
	if (published) return published;
	if (IS_WINDOWS) return registrySteamDir();
	return steamDirCandidates(process.platform, homedir()).find((dir) => existsSync(dir)) ?? null;
}

/**
 * The POSIX install locations, most authoritative first, mirroring
 * backend/main.lua steam_dir_candidates: the native ones on Linux and then
 * Steam's Flatpak per-app directory as the host sees it (inside the sandbox
 * the native entries already resolve there through --persist=.), and the
 * Application Support directory on macOS. Windows is not among them: the
 * registry is the only source there.
 */
export function steamDirCandidates(platform: NodeJS.Platform, home: string): string[] {
	if (platform === 'win32') return [];
	if (platform === 'darwin') return [join(home, 'Library', 'Application Support', 'Steam')];
	const flatpak = join(home, '.var', 'app', 'com.valvesoftware.Steam');
	return [
		join(home, '.steam', 'steam'),
		join(home, '.local', 'share', 'Steam'),
		join(flatpak, '.local', 'share', 'Steam'),
		join(flatpak, '.steam', 'steam'),
	];
}

function registrySteamDir(): string | null {
	const keys: Array<[string, string]> = [
		['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
		['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
		['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
	];
	for (const [key, name] of keys) {
		// Spawning a missing `reg` throws rather than answering with an exit
		// code, and this function's contract is an answer or null, never a
		// throw: a Windows install stripped of reg reads as "not found".
		let proc: Bun.SyncSubprocess;
		try {
			proc = Bun.spawnSync(['reg', 'query', key, '/v', name]);
		} catch {
			return null;
		}
		if (proc.exitCode !== 0) continue;
		const m = /REG_SZ\s+(.+?)\s*$/m.exec(proc.stdout.toString());
		if (!m) continue;
		const dir = m[1].replace(/\//g, '\\');
		if (existsSync(dir)) return dir;
	}
	return null;
}

/**
 * Where starlight's output_path = "auto" installs the .star: under the Steam
 * install on Windows (MILLENNIUM__PLUGINS_PATH = <install>/plugins), under
 * $XDG_DATA_HOME/millennium on Linux and under Library/Application Support
 * on macOS, the two places Millennium's own environment.cc puts its plugin
 * directory (docs/platforms.md). Null when the Windows install cannot be
 * found.
 */
export function starPath(): string | null {
	return starPathFor(process.platform, process.env, homedir(), steamDir());
}

/** starPath's rule, one argument per thing it reads, so every platform's branch is testable on one machine. */
export function starPathFor(platform: NodeJS.Platform, env: Env, home: string, steam: string | null): string | null {
	const file = `${PLUGIN_ID}.star`;
	if (platform === 'win32') return steam ? join(steam, 'millennium', 'plugins', file) : null;
	if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Millennium', 'plugins', file);
	return join(xdgDir(env, 'XDG_DATA_HOME', join(home, '.local', 'share')), 'millennium', 'plugins', file);
}

/**
 * Millennium's loader lines on Linux go to Steam's console log (the
 * "Delegating frontend load" stamp that dates the running frontend). Null
 * elsewhere: Windows has no such log (Millennium logs to its own console
 * there), and the macOS one is unverified.
 */
export function steamConsoleLogPath(): string | null {
	return steamConsoleLogPathFor(process.platform, steamDir());
}

/** steamConsoleLogPath's rule, taking the Steam directory it hangs off, so both branches are testable. */
export function steamConsoleLogPathFor(platform: NodeJS.Platform, steam: string | null): string | null {
	if (platform !== 'linux' || steam === null) return null;
	return join(steam, 'logs', 'console-linux.txt');
}

/** Every non-empty line of plugin.log; an empty array when there is none. */
export function readPluginLog(): string[] {
	const path = pluginLogPath();
	if (!existsSync(path)) return [];
	return readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l !== '');
}

/**
 * The `[YYYY-MM-DD HH:MM:SS]` stamp a log line opens with, or null. A stamp
 * the shape matches but the calendar does not is null too: an Invalid Date is
 * truthy, and every caller compares the answer against another moment.
 */
export function parseStamp(line: string): Date | null {
	const m = /^\[([0-9-]+ [0-9:]+)\]/.exec(line);
	if (!m) return null;
	const d = new Date(m[1].replace(' ', 'T'));
	return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * One command into the dev door, written whole: one JSON line lands in a
 * sibling temp file first and is renamed into place, so the backend's
 * consume-once read never sees a partial command. UTF-8 without a BOM and
 * an LF newline: the backend hands the bytes to the frontend's JSON parse.
 */
export function writeDevFire(command: object): void {
	const dir = runtimeDir();
	mkdirSync(dir, { recursive: true });
	const target = join(dir, '.dev-fire');
	const tmp = `${target}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(command)}\n`, { encoding: 'utf8' });
	renameSync(tmp, target);
}

/**
 * The header comment of a tool is its usage text, the way tools/fire and
 * tools/mep have always printed their own: every leading comment line after
 * the shebang, with the comment marker stripped.
 */
export function usageFromHeader(file: string): string {
	const out: string[] = [];
	for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
		if (line.startsWith('#!')) continue;
		if (!line.startsWith('//')) break;
		out.push(line.replace(/^\/\/ ?/, ''));
	}
	return out.join('\n');
}

export function stamp(d: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
