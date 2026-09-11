import { ffi } from 'millennium';

/**
 * Diagnostics for the whole frontend, kept out of index so any module can log
 * without importing the capture path.
 *
 * The prefixes written here are the plugin's observability contract:
 * tools/lib/snn.ts mirrors them as regexes and tools/capture greps the plugin
 * log with those. Three families are read — startup verdicts (`hook
 * installed`, `hook failed`, `helper`, `g_PopupManager never appeared`,
 * `steam-url: ...`), notification lines (`from-toast `, `toast <name> -> `,
 * `dev-fire`, `replay: ...`, `click-bridge`, `focus:`) and failure lines
 * (delivery, platform, suppression, unreadable payload, dropped, left open).
 * tools/snn.test.ts reads these producers and fails when a prefix in
 * tools/lib/snn.ts is no longer written verbatim by one of them, so renaming
 * a prefix here breaks the suite until snn.ts follows.
 */
const logLine = ffi<[string], string>('Log');

/** Never throws: diagnostics must not take the notification path down. */
export function dlog(line: string): void {
	try {
		void logLine(line);
	} catch {
		/* the log is best-effort by design */
	}
}

/**
 * JSON.stringify throws outright on a BigInt, and Steam's decoded values can be
 * any protobuf scalar. A debug line that throws killed every notification once
 * already, so serialising for logs is done defensively.
 */
export function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)) ?? 'undefined';
	} catch (e) {
		return `<unserialisable: ${(e as Error)?.message ?? e}>`;
	}
}
