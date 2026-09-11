// Millennium's external protocol (MEP), in one place: where the socket is,
// how a message is framed, how a shell parameter becomes a request value,
// and the transport that sends one request and takes one reply.
//
// MEP is a unix socket any local process can speak: 4-byte little-endian
// length prefix, msgpack body (tools/lib/msgpack.ts), one response per
// request. Millennium answers every call with both keys: a success carries
// `error: null` and the answer in `result`, a failure carries the message in
// `error` and `result: null`.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatJson, parseJson } from './json';
import { type Packable, decode, encode } from './msgpack';
import { IS_WINDOWS } from './snn';

/**
 * Millennium's external protocol socket: /tmp on POSIX, the user's temp
 * directory on Windows (Millennium: src/include/mep/mep_server.h).
 */
export function mepSocketPath(): string {
	return IS_WINDOWS ? join(tmpdir(), 'millennium-mep.sock') : '/tmp/millennium-mep.sock';
}

/** MEP's framing: a 4-byte little-endian body length, then the body. */
export function frame(body: Uint8Array): Uint8Array {
	const out = new Uint8Array(4 + body.length);
	new DataView(out.buffer).setUint32(0, body.length, true);
	out.set(body, 4);
	return out;
}

/**
 * Pull one complete frame off the front of a byte buffer, or null while the
 * buffer is still short. The header alone is not a frame.
 */
export function takeFrame(buf: Uint8Array): { body: Uint8Array; rest: Uint8Array } | null {
	if (buf.length < 4) return null;
	const len = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, true);
	if (buf.length < 4 + len) return null;
	return { body: buf.subarray(4, 4 + len), rest: buf.subarray(4 + len) };
}

/** Every JSON value is packable; this is the proof the type system wants. */
function isPackable(v: unknown): v is Packable {
	if (v === null) return true;
	switch (typeof v) {
		case 'boolean':
		case 'number':
		case 'bigint':
		case 'string':
			return true;
		case 'object':
			if (v instanceof Uint8Array) return true;
			if (Array.isArray(v)) return v.every(isPackable);
			return Object.values(v).every(isPackable);
		default:
			return false;
	}
}

/** key=value; the value is JSON when it parses as JSON, else a plain string. */
export function parseMepParam(token: string): [string, Packable] {
	const eq = token.indexOf('=');
	if (eq < 0) throw new Error(`parameters look like key=value, got: ${token}`);
	const key = token.slice(0, eq);
	const raw = token.slice(eq + 1);
	let value: unknown;
	try {
		value = parseJson(raw);
	} catch {
		return [key, raw];
	}
	if (!isPackable(value)) throw new Error(`parameter ${key} is not a value MEP can carry: ${raw}`);
	return [key, value];
}

export const USEFUL_MEP_METHODS = [
	'millennium.version', 'millennium.status',
	'plugin.list', 'plugin.get', 'plugin.status',
	'plugin.enable', 'plugin.disable', 'plugin.restart',
	'plugin.config.get', 'plugin.config.set',
	'plugin.config.delete', 'plugin.config.get_all',
];

/**
 * What Millennium sends back. `error` is null on success and the message (or
 * any other value: an empty map or a zero is still an error) on failure, so
 * a caller tests its presence as a value, never its truthiness.
 */
export interface Reply {
	id: unknown;
	error: unknown;
	result: unknown;
}

export interface MepCallOptions {
	socketPath?: string;
	timeoutMs?: number;
}

/**
 * One request, one reply. Rejects with the reason the call never got
 * through: no socket, a refused connection, a reply that never completed,
 * a second frame after the first, or a reply that is not a map.
 */
export function mepCall(method: string, params: Record<string, Packable>, opts: MepCallOptions = {}): Promise<Reply> {
	// No existence check up front: on Windows the socket is a reparse point
	// that stat cannot see, so the connect itself is the test.
	const socket = opts.socketPath ?? mepSocketPath();
	const timeoutMs = opts.timeoutMs ?? 5000;
	const request: Record<string, Packable> = { id: 'mep-cli', method };
	if (Object.keys(params).length) request.params = params;
	const out = frame(encode(request));

	// Bun sockets do not buffer: a write may take fewer bytes than offered,
	// and the rest goes out from the drain callback.
	let sent = 0;
	const pump = (s: { write(data: Uint8Array): number }) => {
		while (sent < out.length) {
			const n = s.write(out.subarray(sent));
			if (n <= 0) return;
			sent += n;
		}
	};

	// The reply arrives in chunks. A reply is one small frame, so each chunk
	// joins what came before and takeFrame decides whether that is yet a whole
	// frame.
	const chunks: Uint8Array[] = [];
	let taken = false;

	return new Promise<Reply>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`no complete reply within ${timeoutMs / 1000} s`)), timeoutMs);
		const finish = (fn: () => void) => {
			clearTimeout(timer);
			fn();
		};
		Bun.connect({
			unix: socket,
			socket: {
				open(s) {
					pump(s);
				},
				drain(s) {
					pump(s);
				},
				data(s, chunk) {
					chunks.push(chunk);
					const got = takeFrame(Buffer.concat(chunks));
					if (!got) return;
					taken = true;
					s.end();
					if (got.rest.length) return finish(() => reject(new Error(`${got.rest.length} byte(s) after the reply frame -- more than one response`)));
					finish(() => {
						try {
							resolve(asReply(decode(got.body)));
						} catch (e) {
							reject(e);
						}
					});
				},
				close() {
					if (!taken) finish(() => reject(new Error('connection closed before a complete reply')));
				},
				error(_s, e) {
					finish(() => reject(e));
				},
				connectError(_s, e) {
					const code = (e as NodeJS.ErrnoException).code;
					finish(() => reject(new Error(code === 'ENOENT'
						? `${socket} is not there -- is Steam running with Millennium?`
						: `${socket} refused the connection -- Millennium may be starting up. (${e.message})`)));
				},
			},
		}).catch((e: Error) => finish(() => reject(e)));
	});
}

// The map is handed back as decoded, every key in its wire order, so a
// caller printing it shows exactly what Millennium sent.
function asReply(reply: unknown): Reply {
	if (!reply || typeof reply !== 'object' || Array.isArray(reply)) throw new Error(`reply is not a map:\n${formatJson(reply)}`);
	return reply as Reply;
}
