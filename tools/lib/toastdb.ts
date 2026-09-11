// The toast oracle on Windows: what Windows itself recorded, read out of the
// notification platform's own database, for tools/capture's "delivered" line.
//
// Every toast the platform accepts is stored in
// %LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db; the row
// carries the exact XML tools/notify-action.ps1 handed to
// ToastNotificationManager, so a row proves delivery reached Windows, not
// merely that the helper exited 0.
//
// WpnUserService keeps that database open and in WAL mode, and a WAL reader
// does not block on the writer: it reads the snapshot the WAL describes while
// the service goes on appending. So the file is opened directly, read-only,
// and every row is the truth of the moment the read began. The one window in
// which a reader can be locked out is a checkpoint restarting or truncating
// the WAL, which takes an exclusive lock for a few milliseconds; the busy
// timeout waits that out rather than failing the read.
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_ID, localAppData } from './snn';

export interface ToastRow {
	id: number;
	arrived: Date;
	xml: string;
}

interface RawRow {
	Id: bigint;
	ArrivalTime: bigint;
	Payload: Uint8Array | null;
}

const FILETIME_EPOCH_MS = 11644473600000n;

function fromFileTime(ticks: bigint): Date {
	return new Date(Number(ticks / 10000n - FILETIME_EPOCH_MS));
}

/**
 * The Payload column is a BLOB the platform writes as UTF-16LE (with or
 * without a BOM); older rows can be UTF-8. Sniffed from the first bytes.
 */
function decodePayload(b: Uint8Array | null): string {
	if (!b || b.length === 0) return '';
	if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
	if (b.length >= 2 && b[1] === 0x00) return new TextDecoder('utf-16le').decode(b);
	return new TextDecoder('utf-8').decode(b);
}

// Toasts only: the table also holds tile and badge updates and this
// AUMID's own payload-less toastCondensed rows, none of which is a card.
const SQL =
	'select n.Id, n.ArrivalTime, n.Payload from Notification n ' +
	'join NotificationHandler h on n.HandlerId = h.RecordId ' +
	"where n.Type = 'toast' and h.PrimaryId = ? " +
	'order by n.ArrivalTime desc, n.Id desc limit ?';

/** Long enough to outlast a checkpoint's exclusive lock, short enough that a genuinely stuck database is reported rather than waited on. */
const BUSY_TIMEOUT_MS = 5000;

/** The plugin's toasts in the database at `src`, newest first. */
export function readToasts(src: string, limit = 10): ToastRow[] {
	const db = new Database(src, { readonly: true, safeIntegers: true });
	try {
		db.exec(`pragma busy_timeout = ${BUSY_TIMEOUT_MS}`);
		return (db.query(SQL).all(PLUGIN_ID, BigInt(limit)) as RawRow[]).map((r) => ({
			id: Number(r.Id),
			arrived: fromFileTime(r.ArrivalTime),
			xml: decodePayload(r.Payload),
		}));
	} finally {
		db.close();
	}
}

/** The toasts this plugin delivered, newest first. */
export function toastRows(limit = 10): ToastRow[] {
	const src = join(localAppData(), 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db');
	if (!existsSync(src)) throw new Error(`no notification database at ${src}`);
	return readToasts(src, limit);
}

export interface ToastFacts {
	title: string | null;
	body: string | null;
	imageSrc: string;
	imageCrop: string;
	launch: string;
	activationType: string;
}

const unescapeXml = (s: string): string =>
	s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

/**
 * The assertable slots of one toast's XML, in the shape
 * tools/notify-action.ps1 builds: two <text> nodes (title, body), an optional
 * appLogoOverride <image>, and the launch attribute carrying
 * steam://steam-native-notifications/notification/<envelope>. Pattern-matched
 * rather than parsed: the helper writes this one shape and nothing else.
 */
export function toastFacts(xml: string): ToastFacts {
	const attr = (name: string): string => {
		const m = new RegExp(`<toast\\b[^>]*\\s${name}="([^"]*)"`).exec(xml);
		return m ? unescapeXml(m[1]) : '';
	};
	const texts = [...xml.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => unescapeXml(m[1]));
	const image = /<image\b([^>]*)\/?>/.exec(xml);
	const imageAttr = (name: string): string => {
		if (!image) return '';
		const m = new RegExp(`\\s${name}="([^"]*)"`).exec(image[1]);
		return m ? unescapeXml(m[1]) : '';
	};
	return {
		title: texts[0] ?? null,
		body: texts[1] ?? null,
		imageSrc: imageAttr('src'),
		imageCrop: imageAttr('hint-crop'),
		launch: attr('launch'),
		activationType: attr('activationType'),
	};
}
