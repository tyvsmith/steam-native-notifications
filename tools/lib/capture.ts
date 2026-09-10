// The two verdicts tools/capture prints about the build on disk, kept pure so
// tools/capture.test.ts can pin them: a stale build is indistinguishable from
// a broken feature, so these are the highest-stakes lines the tool prints.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type Staleness =
	| { kind: 'current' }
	| { kind: 'stale' }
	| { kind: 'unknown-age' }
	| { kind: 'never-loaded' }
	| { kind: 'no-star' };

/**
 * Is the frontend Steam is running the .star on disk? `built` is the .star's
 * mtime (null when there is none), `loaded` the stamp that dates the running
 * frontend (Millennium's loader line, else the hook verdict), and
 * `backendLoadedLineSeen` whether plugin.log holds a backend stamp at all.
 * With a load stamp the answer compares the two dates; no .star then is
 * 'no-star', never 'current', since there is nothing to be current against.
 * Without a load stamp the .star does not matter: the backend loaded but the
 * hook verdict was truncated away ('unknown-age'), or nothing ever loaded.
 */
export function staleness(built: Date | null, loaded: Date | null, backendLoadedLineSeen: boolean): Staleness {
	if (loaded) {
		if (!built) return { kind: 'no-star' };
		return built > loaded ? { kind: 'stale' } : { kind: 'current' };
	}
	return backendLoadedLineSeen ? { kind: 'unknown-age' } : { kind: 'never-loaded' };
}

export interface Source {
	path: string;
	mtime: Date;
}

// The build inputs are whatever millennium.toml names, plus the manifest
// itself. The three code sections -- [frontend], [backend] and the [webkit]
// one this manifest deliberately omits -- name an entry or a glob, and each is
// taken at its first path segment because an entry pulls in its whole tree.
// An [assets] path is the one file it names. Every other section ([plugin],
// [compiler]) holds settings, not inputs.
const CODE_SECTIONS = ['frontend', 'backend', 'webkit'];

// tools/gen-proto.mjs writes frontend/generated/notifications.ts as the first
// step of `bun run build`, so its mtime is the build's, not the working
// tree's: counting it would compare build output with build output and call
// every tree newer than its own .star.
const GENERATED = 'frontend/generated';

/**
 * The newest build input under `repoRoot`, by mtime, so "would a build change
 * anything" is answered without running one (a build would overwrite the
 * running plugin). Null when the manifest is missing.
 */
export function newestSource(repoRoot: string, manifestToml: string): Source | null {
	const toml = Bun.TOML.parse(manifestToml) as Record<string, Record<string, unknown> | undefined>;
	// A section's values are strings and arrays of strings; flatten to paths.
	const paths = (section: string): string[] => Object.values(toml[section] ?? {}).flat().filter((v) => typeof v === 'string');
	const roots = new Set<string>(['millennium.toml']);
	for (const section of CODE_SECTIONS) for (const p of paths(section)) roots.add(p.split('/')[0]);
	for (const p of paths('assets')) roots.add(p);
	const generated = join(repoRoot, GENERATED);
	let newest: Source | null = null;
	const visit = (p: string) => {
		if (p === generated || !existsSync(p)) return;
		const st = statSync(p);
		if (st.isDirectory()) {
			for (const child of readdirSync(p)) visit(join(p, child));
		} else if (!newest || st.mtime > newest.mtime) {
			newest = { path: p, mtime: st.mtime };
		}
	};
	for (const r of roots) visit(join(repoRoot, r));
	return newest;
}
