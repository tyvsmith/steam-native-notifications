import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { newestSource, staleness } from './lib/capture';

const T0 = new Date('2026-09-01T12:00:00Z');
const T1 = new Date('2026-09-01T13:00:00Z');

describe('the staleness verdict', () => {
	test('a .star built after the frontend loaded is stale', () => {
		expect(staleness(T1, T0, true)).toEqual({ kind: 'stale' });
	});

	test('a .star built before the frontend loaded is current', () => {
		expect(staleness(T0, T1, true)).toEqual({ kind: 'current' });
	});

	test('a .star built at the very moment of the load is current, not stale', () => {
		expect(staleness(T0, new Date(T0), true)).toEqual({ kind: 'current' });
	});

	test('no load stamp with a backend stamp in the log is a frontend of unknown age', () => {
		expect(staleness(T0, null, true)).toEqual({ kind: 'unknown-age' });
		expect(staleness(null, null, true)).toEqual({ kind: 'unknown-age' });
	});

	test('nothing at all is never loaded', () => {
		expect(staleness(T0, null, false)).toEqual({ kind: 'never-loaded' });
		expect(staleness(null, null, false)).toEqual({ kind: 'never-loaded' });
	});

	test('a load stamp with no .star is not current, there is nothing to be current against', () => {
		expect(staleness(null, T0, true)).toEqual({ kind: 'no-star' });
	});
});

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MANIFEST = `
[plugin]
id = "x"

[assets]
resources = ["tools/notify-action", "tools/missing"]

[backend]
entry = "backend/main.lua"
sources = ["backend/**/*.lua"]

[frontend]
entry = "frontend/index.tsx"
`;

/** A repo of mtime-stamped files; `files` maps a relative path to its mtime. */
function fixture(files: Record<string, Date>): string {
	const root = mkdtempSync(join(tmpdir(), 'capture-test-'));
	dirs.push(root);
	for (const [rel, mtime] of Object.entries(files)) {
		const path = join(root, rel);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, rel);
		utimesSync(path, mtime, mtime);
	}
	return root;
}

const at = (h: number) => new Date(Date.UTC(2026, 8, 1, h));

describe('the newest source', () => {
	test('a nested file under a code entry\'s first segment wins', () => {
		const root = fixture({
			'millennium.toml': at(1),
			'frontend/index.tsx': at(2),
			'frontend/deep/er/leaf.ts': at(5),
			'backend/main.lua': at(3),
			'tools/notify-action': at(4),
		});
		expect(newestSource(root, MANIFEST)).toEqual({ path: join(root, 'frontend/deep/er/leaf.ts'), mtime: at(5) });
	});

	test('an [assets] file counts, as the one file it names', () => {
		const root = fixture({
			'millennium.toml': at(1),
			'frontend/index.tsx': at(2),
			'tools/notify-action': at(5),
			'tools/notify-action.ps1': at(9),
		});
		expect(newestSource(root, MANIFEST)).toEqual({ path: join(root, 'tools/notify-action'), mtime: at(5) });
	});

	test('the generated file the build itself writes is ignored', () => {
		const root = fixture({
			'millennium.toml': at(1),
			'frontend/index.tsx': at(2),
			'frontend/generated/notifications.ts': at(9),
		});
		expect(newestSource(root, MANIFEST)).toEqual({ path: join(root, 'frontend/index.tsx'), mtime: at(2) });
	});

	test('millennium.toml itself counts', () => {
		const root = fixture({
			'millennium.toml': at(5),
			'frontend/index.tsx': at(2),
		});
		expect(newestSource(root, MANIFEST)).toEqual({ path: join(root, 'millennium.toml'), mtime: at(5) });
	});

	test('a missing path is skipped, not an error', () => {
		const root = fixture({ 'backend/main.lua': at(2) });
		expect(newestSource(root, MANIFEST)).toEqual({ path: join(root, 'backend/main.lua'), mtime: at(2) });
	});

	test('an empty tree is null', () => {
		expect(newestSource(fixture({}), MANIFEST)).toBeNull();
	});
});
