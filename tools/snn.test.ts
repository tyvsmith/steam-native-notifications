import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
	LOG, PLUGIN_ID, parseStamp, runtimeDir, runtimeDirFor, starPathFor, steamConsoleLogPathFor, steamDirCandidates,
} from './lib/snn';

// backend/main.lua log_line and tools/notify-action.ps1 Write-PluginLog write
// the same shape, so a test line is composed the way the producers compose it.
const line = (message: string) => `[2026-09-07 21:14:03] [steam-native-notifications] ${message}`;

// The lines a load writes, by producer. The startup section must show the
// backend's verdict on the helper it materializes at load, and must not show
// the per-click focus helper's own lines.
const STARTUP_LINES = [
	'hook installed', // frontend/index.tsx:266
	'hook failed: g_PopupManager.AddPopupCreatedCallback is not a function', // frontend/index.tsx:268
	'g_PopupManager never appeared; bridge inactive', // frontend/index.tsx:258
	'helper: /home/ty/.cache/steam-native-notifications/notify-action', // backend/main.lua:523
	'helper install FAILED: asset tools/notify-action missing from the plugin bundle -- notifications will not be delivered', // backend/main.lua:525
	'helper -Setup could not run -- toasts may be unbranded', // backend/main.lua:532
	'CreateProcessW failed for the Windows helper: 2', // backend/main.lua:225
	'desktop delivery is not implemented on macos -- notifications will not be delivered (docs/platforms.md)', // backend/main.lua:519
	'steam-url: registered steam://steam-native-notifications/notification/<payload>', // frontend/steamurl.ts:57
];

// The lines one notification writes, from the frontend's read of Steam's toast
// through to the platform's answer, including every way either end reports a
// notification it could not deliver.
const NOTIFICATION_LINES = [
	'from-toast notificationtoasts_10004_desktop type=8 (wishlist) source=server {"appid":1073390}', // frontend/index.tsx:170
	'toast notificationtoasts_10004_desktop -> {"title":"Aircar","replayable":true}', // frontend/index.tsx:210
	'toast notificationtoasts_10004_desktop left open: backend answered unsupported', // frontend/index.tsx:218
	'toast notificationtoasts_10004_desktop left open: notify failed: transport closed', // frontend/index.tsx:133
	'could not close notificationtoasts_10004_desktop: popup already destroyed', // frontend/index.tsx:224
	'dev-fire: NotificationStore.TestFriendMessage([null,"Ready to play?"])', // frontend/devfire.ts:148
	'replay: candidates notificationtoasts_10004_desktop n=3 onClick@4', // frontend/replay.ts:164
	'replay: invoke notificationtoasts_10004_desktop onClick@4 age=7s', // frontend/replay.ts:253
	'click-bridge: desktop steam://url/StoreAppPage/1073390', // frontend/clickbridge.ts:155
	'steam-url: click token=1a2b3c4d', // frontend/steamurl.ts:51
	'steam-url: ignored steam://open/console', // frontend/steamurl.ts:48
	'focus: raised main', // tools/notify-action.ps1:336
	'focus: helper failed: Exception calling "Raise"', // tools/notify-action.ps1:339
	'unsupported platform: macos delivery is not implemented, notification dropped', // backend/main.lua:258
	'could not write C:\\Users\\ty\\AppData\\Local\\steam-native-notifications\\1757.notify; notification dropped', // backend/main.lua:268
	'payload write failed for C:\\Users\\ty\\AppData\\Local\\steam-native-notifications\\1757.notify; notification dropped', // backend/main.lua:281
	'payload 1757-1 unreadable, notification dropped: Unexpected end of JSON input', // tools/notify-action.ps1:115
	'delivery suppressed during platform back-off: Download Complete', // tools/notify-action.ps1:129
	'notification platform unavailable, backing off 60s: The notification platform is unavailable.', // tools/notify-action.ps1:379
	'toast delivery failed: Element not found.', // tools/notify-action.ps1:381
];

describe('the log prefixes the tools read', () => {
	test('the startup section catches every line a load writes', () => {
		for (const message of STARTUP_LINES) expect(LOG.startup.test(line(message))).toBe(true);
	});

	test('the per-click focus helper stays out of the startup section', () => {
		// tools/notify-action.ps1:336 and :339 name a helper too, and fire once
		// per click: a startup section that greps the bare word shows them.
		expect(LOG.startup.test(line('focus: raised main'))).toBe(false);
		expect(LOG.startup.test(line('focus: helper failed: Exception calling "Raise"'))).toBe(false);
	});

	test('the notification section catches every line one notification writes', () => {
		for (const message of NOTIFICATION_LINES) expect(LOG.notification.test(line(message))).toBe(true);
	});

	test('the backend load verdict is not a notification', () => {
		expect(LOG.notification.test(line('helper: /home/ty/.cache/steam-native-notifications/notify-action'))).toBe(false);
		expect(LOG.notification.test(line('hook installed'))).toBe(false);
	});

	test('the hook verdict is the frontend line that dates a start', () => {
		expect(LOG.hook.test(line('hook installed'))).toBe(true);
		expect(LOG.hook.test(line('hook failed: undefined is not a function'))).toBe(true);
		expect(LOG.hook.test(line('g_PopupManager never appeared; bridge inactive'))).toBe(true);
		expect(LOG.hook.test(line('toast notificationtoasts_10004_desktop -> {}'))).toBe(false);
	});

	test('a renamed prefix reads as nothing logged, never as a stale answer', () => {
		expect(LOG.startup.test(line('Hook Installed'))).toBe(false);
		expect(LOG.notification.test(line('From-Toast notificationtoasts_10004_desktop'))).toBe(false);
	});
});

describe('log stamps', () => {
	test('reads the stamp a log line opens with', () => {
		expect(parseStamp(line('hook installed'))).toEqual(new Date('2026-09-07T21:14:03'));
	});

	test('a line with no stamp is null', () => {
		expect(parseStamp('hook installed')).toBeNull();
		expect(parseStamp('')).toBeNull();
	});

	test('a stamp the calendar refuses is null, not an Invalid Date', () => {
		// The shape matches, so the answer would otherwise be a truthy Date
		// that compares false against every moment a caller tests it against.
		expect(parseStamp('[2026-13-45 99:99:99] [steam-native-notifications] hook installed')).toBeNull();
		expect(parseStamp('[--- ::] [steam-native-notifications] hook installed')).toBeNull();
	});
});

describe('runtime directory', () => {
	const home = '/home/ty';

	test('XDG_CACHE_HOME when it is set', () => {
		expect(runtimeDirFor('linux', { XDG_CACHE_HOME: '/run/user/1000/cache' }, home))
			.toBe(join('/run/user/1000/cache', 'steam-native-notifications'));
	});

	test('set to the empty string means unset, as the XDG spec has it', () => {
		expect(runtimeDirFor('linux', { XDG_CACHE_HOME: '' }, home)).toBe(join(home, '.cache', 'steam-native-notifications'));
		expect(runtimeDirFor('linux', {}, home)).toBe(join(home, '.cache', 'steam-native-notifications'));
	});

	test('macOS keeps its caches in Library, Windows in local app data', () => {
		expect(runtimeDirFor('darwin', { XDG_CACHE_HOME: '/ignored' }, home))
			.toBe(join(home, 'Library', 'Caches', 'steam-native-notifications'));
		expect(runtimeDirFor('win32', { LOCALAPPDATA: 'C:\\Users\\ty\\AppData\\Local' }, 'C:\\Users\\ty'))
			.toBe(join('C:\\Users\\ty\\AppData\\Local', 'steam-native-notifications'));
		expect(runtimeDirFor('win32', { USERPROFILE: 'C:\\Users\\ty' }, 'C:\\elsewhere'))
			.toBe(join('C:\\Users\\ty', 'AppData', 'Local', 'steam-native-notifications'));
	});

	test('runtimeDir reads the live environment', () => {
		// The rule itself is exercised above on every platform; this pins that
		// the exported entry point feeds it process.env, not a snapshot.
		const key = process.platform === 'win32' ? 'LOCALAPPDATA' : 'XDG_CACHE_HOME';
		const saved = process.env[key];
		try {
			process.env[key] = join('/tmp', 'snn-test-base');
			expect(runtimeDir()).toBe(join('/tmp', 'snn-test-base', 'steam-native-notifications'));
		} finally {
			if (saved === undefined) delete process.env[key];
			else process.env[key] = saved;
		}
	});
});

describe('where the installed .star lives', () => {
	const home = '/home/ty';
	const file = `${PLUGIN_ID}.star`;

	test('Linux honours XDG_DATA_HOME, which Millennium reads too', () => {
		expect(starPathFor('linux', { XDG_DATA_HOME: '/srv/data' }, home, null))
			.toBe(join('/srv/data', 'millennium', 'plugins', file));
	});

	test('an empty XDG_DATA_HOME falls back to ~/.local/share', () => {
		expect(starPathFor('linux', { XDG_DATA_HOME: '' }, home, null))
			.toBe(join(home, '.local', 'share', 'millennium', 'plugins', file));
		expect(starPathFor('linux', {}, home, null))
			.toBe(join(home, '.local', 'share', 'millennium', 'plugins', file));
	});

	test('macOS installs under Application Support', () => {
		expect(starPathFor('darwin', {}, home, null))
			.toBe(join(home, 'Library', 'Application Support', 'Millennium', 'plugins', file));
	});

	test('Windows hangs off the Steam install, and is null without one', () => {
		expect(starPathFor('win32', {}, home, 'C:\\Program Files (x86)\\Steam'))
			.toBe(join('C:\\Program Files (x86)\\Steam', 'millennium', 'plugins', file));
		expect(starPathFor('win32', {}, home, null)).toBeNull();
	});
});

describe('Steam install locations', () => {
	const home = '/home/ty';

	test('Linux tries what backend/main.lua tries, in its order', () => {
		const flatpak = join(home, '.var', 'app', 'com.valvesoftware.Steam');
		expect(steamDirCandidates('linux', home)).toEqual([
			join(home, '.steam', 'steam'),
			join(home, '.local', 'share', 'Steam'),
			join(flatpak, '.local', 'share', 'Steam'),
			join(flatpak, '.steam', 'steam'),
		]);
	});

	test('macOS has one, Windows none: there the registry is the only source', () => {
		expect(steamDirCandidates('darwin', home)).toEqual([join(home, 'Library', 'Application Support', 'Steam')]);
		expect(steamDirCandidates('win32', 'C:\\Users\\ty')).toEqual([]);
	});

	test('the Steam console log hangs off the Steam directory it belongs to', () => {
		expect(steamConsoleLogPathFor('linux', '/home/ty/.local/share/Steam'))
			.toBe(join('/home/ty/.local/share/Steam', 'logs', 'console-linux.txt'));
		expect(steamConsoleLogPathFor('linux', null)).toBeNull();
		// Millennium logs to its own console on Windows, and the macOS log is
		// unverified: neither has a console log for the tools to read.
		expect(steamConsoleLogPathFor('win32', 'C:\\Program Files (x86)\\Steam')).toBeNull();
		expect(steamConsoleLogPathFor('darwin', '/Users/ty/Library/Application Support/Steam')).toBeNull();
	});
});
