import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	LOG, LOG_PREFIXES, PLUGIN_ID, parseStamp, runtimeDir, runtimeDirFor, starPathFor, steamConsoleLogPathFor, steamDirCandidates,
} from './lib/snn';

// backend/main.lua log_line and tools/notify-action.ps1 Write-PluginLog write
// the same shape, so a test line is composed the way the producers compose it.
const line = (message: string) => `[2026-09-07 21:14:03] [steam-native-notifications] ${message}`;

// Every file that writes to plugin.log. A prefix in LOG_PREFIXES must be
// written verbatim by one of these, or tools/capture is grepping for a line
// nobody produces.
const PRODUCERS = [
	'frontend/index.tsx',
	'frontend/steamurl.ts',
	'frontend/clickbridge.ts',
	'frontend/replay.ts',
	'frontend/devfire.ts',
	'backend/main.lua',
	'tools/notify-action',
	'tools/notify-action.ps1',
];
const root = join(import.meta.dir, '..');
const producerLines = PRODUCERS.map((file) => ({ file, lines: readFileSync(join(root, file), 'utf8').split(/\r?\n/) }));

// A prefix is produced when one line of one producer carries each of its
// literal pieces in order, the first of them after a quote so a mention in a
// comment or an identifier does not count. `.*` is the only regex syntax the
// prefixes use (the toast name in `toast .* -> `), so the pieces are what
// remains around it. A comment that happens to quote the prefix still passes:
// the check is cheap, not a parser.
function producedBy(prefix: string): string[] {
	const pieces = prefix.split('.*');
	return producerLines
		.filter(({ lines }) => lines.some((text) => {
			let at = text.indexOf(pieces[0]);
			if (at < 0 || !/['"`]/.test(text.slice(0, at))) return false;
			for (const piece of pieces.slice(1)) {
				at = text.indexOf(piece, at + 1);
				if (at < 0) return false;
			}
			return true;
		}))
		.map(({ file }) => file);
}

describe('the log prefixes the tools read', () => {
	for (const [section, prefixes] of Object.entries(LOG_PREFIXES)) {
		test(`every ${section} prefix is written by a producer`, () => {
			for (const prefix of prefixes) {
				const files = producedBy(prefix);
				if (files.length === 0) {
					throw new Error(`${section} prefix ${JSON.stringify(prefix)} is not written by any of: ${PRODUCERS.join(', ')}`);
				}
			}
		});
	}

	test('each regex is the alternation of its prefixes, nothing more', () => {
		expect(LOG.hook.source).toBe(LOG_PREFIXES.hook.join('|'));
		expect(LOG.startup.source).toBe(LOG_PREFIXES.startup.join('|'));
		expect(LOG.notification.source).toBe(LOG_PREFIXES.notification.join('|'));
	});

	test('the toast verdict matches with the name in the middle', () => {
		expect(LOG.notification.test(line('toast notificationtoasts_10004_desktop -> {"title":"Aircar"}'))).toBe(true);
		expect(LOG.notification.test(line('toast notificationtoasts_10004_desktop left open: notify failed: transport closed'))).toBe(true);
	});

	test('the per-click focus helper stays out of the startup section', () => {
		// tools/notify-action.ps1 names a helper too, and fires once per
		// click: a startup section that greps the bare word shows them.
		expect(LOG.startup.test(line('focus: raised main'))).toBe(false);
		expect(LOG.startup.test(line('focus: helper failed: Exception calling "Raise"'))).toBe(false);
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
