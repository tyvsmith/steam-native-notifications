// tools/capture, minus the usage header that stays in the entrypoint.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { newestSource, staleness } from '../capture';
import {
	IS_WINDOWS, LOG, PLUGIN_ID, parseStamp, pluginLogPath, readPluginLog, stamp, starPath, steamConsoleLogPath, steamDir,
} from '../snn';
import { toastFacts, toastRows } from '../toastdb';

// `entry` is the extensionless entrypoint that imported this module.
export async function main(entry: string): Promise<void> {

	const arg = process.argv[2];
	const lines = arg === undefined ? 8 : Number(arg);
	if (!Number.isSafeInteger(lines) || lines < 0) {
		console.error('usage: tools/capture [n], n a non-negative integer (default 8)');
		process.exit(2);
	}
	// On Linux Steam's console log is the only thing that dates the running
	// frontend from outside the plugin; no Steam directory, or no log in it, means
	// Steam has never run and the whole report would be guesswork.
	const consoleLog = steamConsoleLogPath();
	if (process.platform === 'linux' && !(consoleLog && existsSync(consoleLog))) {
		console.error(`No Steam log at ${consoleLog ?? '<Steam>/logs/console-linux.txt'} -- is Steam installed and has it run?`);
		process.exit(1);
	}
	const repoRoot = dirname(dirname(entry));
	const plugin = readPluginLog();
	const hr = () => console.log('----------------------------------------------------------------');

	console.log('== 1. is the running plugin the .star on disk? ==');
	const star = starPath();
	let built: Date | null = null;
	if (star && existsSync(star)) {
		built = statSync(star).mtime;
		console.log(`   built   ${stamp(built)}`);
		console.log(`   sha256  ${Bun.CryptoHasher.hash('sha256', readFileSync(star), 'hex')}`);
	} else if (IS_WINDOWS && !steamDir()) {
		console.log('   built   (no Steam install found: no published steam-dir, nothing in the registry)');
	} else {
		console.log('   built   (no .star -- run: bun run build)');
	}

	// The frontend's load stamp: Millennium's loader line where Steam's console
	// log has one, else the frontend's own hook verdict.
	let loaded: Date | null = null;
	if (consoleLog) {
		// Not valid UTF-8 throughout and full of ANSI colour.
		const line = readFileSync(consoleLog, 'latin1')
			.split('\n')
			.findLast((l) => l.includes(PLUGIN_ID) && l.includes('Delegating frontend load'));
		if (line) loaded = parseStamp(line.replace(/\x1b\[[0-9;]*m/g, ''));
	}
	if (!loaded) {
		const hookLine = plugin.findLast((l) => LOG.hook.test(l));
		if (hookLine) loaded = parseStamp(hookLine);
	}
	const shutdown = IS_WINDOWS ? 'steam.exe -shutdown' : 'steam -shutdown';
	if (loaded) console.log(`   loaded  ${stamp(loaded)}`);
	// The verdict (tools/lib/capture.ts). A load stamp with no .star has nothing
	// to be current against, and the built line above already says so.
	switch (staleness(built, loaded, plugin.some((l) => /backend loaded/.test(l))).kind) {
		case 'stale':
			console.log('   STALE -- Steam is running an older build.');
			console.log('   Any change needs a FULL Steam restart (plugin.restart and disable/enable');
			console.log(`   reload nothing that matters here): ${shutdown}, wait, relaunch, re-run this.`);
			break;
		case 'current':
			console.log('   current.');
			break;
		case 'unknown-age':
			console.log('   loaded  (unknown) -- plugin.log holds a backend stamp but no hook verdict:');
			console.log('   a plugin restart or toggle truncated it, and the frontend still running is of');
			console.log('   unknown age. Full Steam restart.');
			break;
		case 'never-loaded':
			console.log('   loaded  (never) -- enable the plugin in Millennium > Plugins.');
			break;
		case 'no-star':
			break;
	}

	// No rebuild here (bun run build would overwrite the running plugin), so the
	// working tree answers "would a build change anything" by mtime alone
	// (tools/lib/capture.ts says which files count).
	const manifest = join(repoRoot, 'millennium.toml');
	const src = existsSync(manifest) ? newestSource(repoRoot, readFileSync(manifest, 'utf8')) : null;
	if (src) {
		console.log(`   sources ${stamp(src.mtime)}  (${src.path.slice(repoRoot.length + 1)})`);
		if (built && src.mtime > built) console.log('   the working tree is newer than the .star -- run: bun run build');
	}

	hr();
	console.log('== 2. did the hook attach, and did startup data load? ==');
	// The prefixes are the contract in frontend/log.ts (tools/lib/snn.ts holds
	// them). `steam-url: registered` is startup work in exactly the way the hook
	// is: without that handler a toast still delivers but every click is a no-op.
	const verdict = plugin.filter((l) => LOG.startup.test(l)).slice(-6);
	if (verdict.length) console.log(verdict.join('\n'));
	else console.log(`   (nothing yet -- no ${pluginLogPath()}; has the backend loaded?)`);

	hr();
	console.log('== 3. what did the last notifications carry? ==');
	// A `dev-fire:` line with no `from-toast` line after it means Steam's own
	// per-type gating swallowed the test fire, not a break. `replay: candidates`
	// shows what the walk stashed for each toast; `steam-url: click token=` +
	// `click-bridge:` + `replay: invoke` show what a click did with it, and
	// `focus:` is the backend's focus helper reporting the foreground it found.
	const matched = plugin.filter((l) => LOG.notification.test(l));
	const notifs = matched.slice(Math.max(0, matched.length - lines));
	if (notifs.length) console.log(notifs.join('\n'));
	else console.log('   (no notifications captured yet -- trigger one)');
	// Windows' own record, under its own heading below the log: the newest row is
	// the newest toast the platform accepted, which is not the outcome of the log
	// line above it. A delivery that failed leaves the previous successful toast
	// as the newest row, and the log lines say which of the two happened.
	if (IS_WINDOWS) {
		console.log('   newest toast Windows recorded:');
		try {
			const row = toastRows(1)[0];
			if (row) {
				const f = toastFacts(row.xml);
				console.log(`      ${stamp(row.arrived)}  '${f.title}' / '${f.body}'  launch=${f.launch}`);
			} else {
				console.log(`      (nothing recorded for ${PLUGIN_ID})`);
			}
		} catch (e) {
			console.log(`      (notification database not readable: ${(e as Error).message})`);
		}
	}
}
