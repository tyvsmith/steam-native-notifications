import { afterEach, describe, expect, test } from 'bun:test';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatJson, parseJson } from './lib/json';
import { frame, mepCall, parseMepParam, takeFrame } from './lib/mep';
import { decode, encode } from './lib/msgpack';

describe('framing', () => {
	test('frames carry a little-endian length and are taken whole', () => {
		const body = encode({ id: 'x' });
		const f = frame(body);
		expect(f[0]).toBe(body.length);
		expect(takeFrame(f.subarray(0, 3))).toBeNull();
		expect(takeFrame(f.subarray(0, f.length - 1))).toBeNull();
		const got = takeFrame(new Uint8Array([...f, 9, 9]));
		expect(got?.body).toEqual(body);
		expect(got?.rest).toEqual(new Uint8Array([9, 9]));
	});
});

describe('tools/mep parameters', () => {
	test('values are JSON when they parse, else strings', () => {
		expect(parseMepParam('name=me.tysmith.steam-native-notifications')).toEqual(['name', 'me.tysmith.steam-native-notifications']);
		expect(parseMepParam('value=true')).toEqual(['value', true]);
		expect(parseMepParam('value=42')).toEqual(['value', 42]);
		expect(parseMepParam('value="go"')).toEqual(['value', 'go']);
		expect(parseMepParam('key=a=b')).toEqual(['key', 'a=b']);
		expect(() => parseMepParam('novalue')).toThrow(/key=value/);
	});

	test('integers beyond 2^53 keep every digit through a request and its reply', () => {
		// A steamid64 is 17 digits; JSON.parse alone would round it to ...680.
		const id = 76561198300097684n;
		expect(parseMepParam('value=76561198300097684')).toEqual(['value', id]);
		expect(parseMepParam('value=42')).toEqual(['value', 42]);
		expect(parseMepParam('value="76561198300097684"')).toEqual(['value', '76561198300097684']);
		expect(parseMepParam('body={"steamid":76561198300097684,"n":1}')).toEqual(['body', { steamid: id, n: 1 }]);
		expect(parseJson('-9007199254740993')).toBe(-9007199254740993n);
		expect(parseJson('9007199254740991')).toBe(9007199254740991);
		expect(parseJson('1.5')).toBe(1.5);

		const request = { id: 'mep-cli', method: 'plugin.config.set', params: { value: id } };
		const wire = encode(request);
		expect(Array.from(wire)).toContain(0xcf);
		expect(decode(wire)).toEqual(request);

		const printed = formatJson({ result: { steamid: id, small: 7 } });
		expect(printed).toContain('"steamid": 76561198300097684');
		expect(printed).toContain('"small": 7');
		expect(parseJson(printed)).toEqual({ result: { steamid: id, small: 7 } });
	});
});

// A stand-in for Millennium's server: one connection, the request collected
// until takeFrame says it is whole, then whatever bytes the test scripted,
// sent the way the test scripted them.
type Sock = Parameters<NonNullable<Bun.SocketHandler<undefined>['data']>>[0];
type Script = (s: Sock, request: Record<string, unknown>) => void | Promise<void>;

const servers: Bun.UnixSocketListener<undefined>[] = [];
const paths: string[] = [];
let n = 0;

function listen(script: Script): string {
	// Unix socket paths are short by law (~108 bytes), so tmpdir, not the
	// project tree.
	const path = join(tmpdir(), `snn-mep-${process.pid}-${n++}.sock`);
	const chunks: Uint8Array[] = [];
	const server = Bun.listen({
		unix: path,
		socket: {
			data(s, chunk) {
				chunks.push(chunk);
				const got = takeFrame(Buffer.concat(chunks));
				if (!got) return;
				expect(got.rest.length).toBe(0);
				void script(s, decode(got.body) as Record<string, unknown>);
			},
		},
	});
	servers.push(server);
	paths.push(path);
	return path;
}

afterEach(() => {
	for (const s of servers.splice(0)) s.stop(true);
	for (const p of paths.splice(0)) {
		try {
			unlinkSync(p);
		} catch {
			// Bun removes it on stop; either way it is gone.
		}
	}
});

const reply = (r: Record<string, unknown>): Uint8Array => frame(encode(r));

describe('mepCall', () => {
	test('one request, one reply, the map as sent', async () => {
		let seen: Record<string, unknown> | undefined;
		const socketPath = listen((s, request) => {
			seen = request;
			s.write(reply({ id: request.id, error: null, result: { version: '2.0.0' } }));
			s.end();
		});
		const got = await mepCall('millennium.version', {}, { socketPath });
		expect(seen).toEqual({ id: 'mep-cli', method: 'millennium.version' });
		expect(got).toEqual({ id: 'mep-cli', error: null, result: { version: '2.0.0' } });
	});

	test('params travel when given, and are absent from the request when empty', async () => {
		let seen: Record<string, unknown> | undefined;
		const socketPath = listen((s, request) => {
			seen = request;
			s.write(reply({ id: 'mep-cli', error: 'no such plugin', result: null }));
			s.end();
		});
		const got = await mepCall('plugin.status', { name: 'x', steamid: 76561198300097684n }, { socketPath });
		expect(seen).toEqual({ id: 'mep-cli', method: 'plugin.status', params: { name: 'x', steamid: 76561198300097684n } });
		expect(got.error).toBe('no such plugin');
	});

	test('a reply split mid-frame across two chunks is reassembled', async () => {
		const socketPath = listen(async (s) => {
			const bytes = reply({ id: 'mep-cli', error: null, result: 'two halves' });
			const cut = 4 + Math.floor((bytes.length - 4) / 2);
			s.write(bytes.subarray(0, cut));
			await Bun.sleep(20);
			s.write(bytes.subarray(cut));
			s.end();
		});
		expect((await mepCall('m', {}, { socketPath })).result).toBe('two halves');
	});

	test('a reply whose 4-byte header arrives alone first is reassembled', async () => {
		const socketPath = listen(async (s) => {
			const bytes = reply({ id: 'mep-cli', error: null, result: 'header first' });
			s.write(bytes.subarray(0, 4));
			await Bun.sleep(20);
			s.write(bytes.subarray(4));
			s.end();
		});
		expect((await mepCall('m', {}, { socketPath })).result).toBe('header first');
	});

	test('two frames in one reply are refused', async () => {
		const two = reply({ id: 'mep-cli', error: null, result: 2 });
		const socketPath = listen((s) => {
			s.write(Buffer.concat([reply({ id: 'mep-cli', error: null, result: 1 }), two]));
			s.end();
		});
		await expect(mepCall('m', {}, { socketPath })).rejects.toThrow(`${two.length} byte(s) after the reply frame -- more than one response`);
	});

	test('a reply that is not a map is refused with its content', async () => {
		const socketPath = listen((s) => {
			s.write(frame(encode([1, 2])));
			s.end();
		});
		await expect(mepCall('m', {}, { socketPath })).rejects.toThrow(/^reply is not a map:\n\[\n  1,\n  2\n\]$/);
	});

	test('a connection closed before a complete frame is an error', async () => {
		const socketPath = listen((s) => {
			s.write(reply({ id: 'mep-cli', error: null, result: 'never whole' }).subarray(0, 6));
			s.end();
		});
		await expect(mepCall('m', {}, { socketPath })).rejects.toThrow('connection closed before a complete reply');
	});

	test('no socket file names the socket and asks after Steam', async () => {
		const socketPath = join(tmpdir(), `snn-mep-${process.pid}-absent.sock`);
		await expect(mepCall('m', {}, { socketPath })).rejects.toThrow(`${socketPath} is not there -- is Steam running with Millennium?`);
	});

	test('a server that never answers times out', async () => {
		const socketPath = listen(() => {
			// Hold the connection open and say nothing.
		});
		await expect(mepCall('m', {}, { socketPath, timeoutMs: 100 })).rejects.toThrow('no complete reply within 0.1 s');
	});

	test('a request larger than one write goes out whole', async () => {
		const big = 'x'.repeat(1 << 20);
		let seen: Record<string, unknown> | undefined;
		const socketPath = listen((s, request) => {
			seen = request;
			s.write(reply({ id: 'mep-cli', error: null, result: (request.params as { value: string }).value.length }));
			s.end();
		});
		const got = await mepCall('plugin.config.set', { value: big }, { socketPath });
		expect((seen?.params as { value: string }).value).toBe(big);
		expect(got.result).toBe(big.length);
	});
});
