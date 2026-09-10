import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLUGIN_ID } from './lib/snn';
import { readToasts, toastRows } from './lib/toastdb';

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
	const dir = mkdtempSync(join(tmpdir(), 'toastdb-test-'));
	dirs.push(dir);
	return dir;
}

/** FILETIME: 100-nanosecond ticks since 1601, the units the platform stores in ArrivalTime. */
function fileTime(ms: number): bigint {
	return (BigInt(ms) + 11644473600000n) * 10000n;
}

// Enough of wpndatabase.db for the reader's query: the two tables it joins,
// the columns it names, and a payload written the way the platform writes
// one. The connection is returned still open and still holding the WAL.
function writer(src: string, arrivals: number[]): Database {
	const db = new Database(src, { create: true });
	db.exec('pragma journal_mode = wal');
	db.exec('create table NotificationHandler (RecordId integer primary key, PrimaryId text)');
	db.exec('create table Notification (Id integer primary key, HandlerId integer, Type text, ArrivalTime integer, Payload blob)');
	db.run('insert into NotificationHandler values (?, ?)', [1, PLUGIN_ID]);
	db.run('insert into NotificationHandler values (?, ?)', [2, 'some.other.app']);
	const insert = db.query('insert into Notification values (?, ?, ?, ?, ?)');
	arrivals.forEach((ms, i) => {
		insert.run(i + 1, 1, 'toast', fileTime(ms), Buffer.from(`<toast>${i + 1}</toast>`, 'utf16le'));
	});
	// Another app's toast and this plugin's payload-less condensed row: rows
	// the query has to leave out.
	insert.run(90, 2, 'toast', fileTime(arrivals[0] ?? 0), Buffer.from('<toast>other</toast>', 'utf16le'));
	insert.run(91, 1, 'toastCondensed', fileTime(arrivals[0] ?? 0), null);
	return db;
}

describe('reading the notification database', () => {
	test('a read-only reader sees the rows a live writer has not checkpointed', () => {
		const src = join(scratch(), 'wpndatabase.db');
		const live = writer(src, [1_700_000_000_000, 1_700_000_060_000, 1_700_000_120_000]);
		try {
			// The writes are in the WAL, not the database file, and the writer
			// still holds the connection open — the state the platform's own
			// service leaves the file in.
			expect(statSync(src + '-wal').size).toBeGreaterThan(0);
			const rows = readToasts(src);
			expect(rows.map((r) => r.id)).toEqual([3, 2, 1]);
			expect(rows[0]!.arrived).toEqual(new Date(1_700_000_120_000));
			expect(rows[0]!.xml).toBe('<toast>3</toast>');
		} finally {
			live.close();
		}
	});

	test('the limit takes the newest rows', () => {
		const src = join(scratch(), 'wpndatabase.db');
		const live = writer(src, [1_700_000_000_000, 1_700_000_060_000, 1_700_000_120_000]);
		try {
			expect(readToasts(src, 2).map((r) => r.id)).toEqual([3, 2]);
		} finally {
			live.close();
		}
	});

	test('a missing database is named, not a bare SQLite error', () => {
		const before = process.env.LOCALAPPDATA;
		process.env.LOCALAPPDATA = scratch();
		try {
			expect(() => toastRows()).toThrow(/no notification database at .*wpndatabase\.db/);
		} finally {
			if (before === undefined) delete process.env.LOCALAPPDATA;
			else process.env.LOCALAPPDATA = before;
		}
	});
});
