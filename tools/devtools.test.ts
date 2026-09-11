import { describe, expect, test } from 'bun:test';
import { isNonNegativeInteger, isToken, planFire } from './lib/devtools';
import { decode, encode } from './lib/msgpack';

describe('msgpack', () => {
	test('round-trips the request/response shapes MEP uses', () => {
		const v = {
			id: 'mep-cli',
			method: 'plugin.config.set',
			params: { name: 'me.tysmith.steam-native-notifications', key: 'devMode', value: true, n: 0, neg: -5, big: 70000, f: 1.5, none: null as null, list: [1, 'two', false] },
		};
		expect(decode(encode(v))).toEqual(v);
	});

	test('picks the smallest integer encodings and reads them back', () => {
		// Each side of every rung boundary, pinned to its leading byte and its
		// width: an encoder that reached for one rung too wide would still
		// round-trip, so round-tripping alone proves nothing here.
		const rungs: [number, number, number][] = [
			[0, 0x00, 1], [127, 0x7f, 1],
			[128, 0xcc, 2], [255, 0xcc, 2],
			[256, 0xcd, 3], [65535, 0xcd, 3],
			[65536, 0xce, 5], [4294967295, 0xce, 5],
			[4294967296, 0xcf, 9], [Number.MAX_SAFE_INTEGER, 0xcf, 9],
			[-1, 0xff, 1], [-32, 0xe0, 1],
			[-33, 0xd0, 2], [-128, 0xd0, 2],
			[-129, 0xd1, 3], [-32768, 0xd1, 3],
			[-32769, 0xd2, 5], [-2147483648, 0xd2, 5],
			[-2147483649, 0xd3, 9], [Number.MIN_SAFE_INTEGER, 0xd3, 9],
		];
		for (const [n, lead, len] of rungs) {
			const b = encode(n);
			expect([n, b[0], b.length]).toEqual([n, lead, len]);
			expect(decode(b)).toBe(n);
		}
	});

	test('an integral double too wide for 64 bits goes out as float64', () => {
		// Number.isInteger says yes to these, and none of them has an exact
		// integer encoding: past 2^64 there is no rung at all.
		for (const n of [1e20, 2 ** 64, -1e20, 1e300]) {
			const b = encode(n);
			expect([n, b[0], b.length]).toEqual([n, 0xcb, 9]);
			expect(decode(b)).toBe(n);
		}
	});

	test('strings of every length class survive', () => {
		for (const n of [0, 31, 32, 255, 256, 70000]) {
			const s = 'é'.repeat(n);
			expect(decode(encode(s))).toBe(s);
		}
	});

	test('rejects a value that ends early', () => {
		const full = encode({ a: 'hello' });
		expect(() => decode(full.subarray(0, full.length - 1))).toThrow(/truncated/);
	});

	test('rejects bytes after the value', () => {
		const two = new Uint8Array([...encode('a'), ...encode('b')]);
		expect(() => decode(two)).toThrow(/trailing/);
	});

	test('rejects extension types rather than guessing', () => {
		expect(() => decode(new Uint8Array([0xd4, 0x01, 0x00]))).toThrow(/unsupported/);
	});
});

describe('tools/fire argument grammar', () => {
	test('client toast: method name plus JSON args, parsed before the write', () => {
		const p = planFire(['TestFriendMessage', 'null', '"Ready to play?"']);
		expect(p).toEqual({ kind: 'queue', command: { call: 'TestFriendMessage', args: [null, 'Ready to play?'] }, message: expect.stringContaining('queued: TestFriendMessage [null,"Ready to play?"]') });
	});

	test('an unquoted string argument is refused before anything is written', () => {
		const p = planFire(['TestFriendMessage', 'null', 'Ready to play?']);
		expect(p.kind).toBe('error');
	});

	test('a method name is a token', () => {
		expect(planFire(['Test Download']).kind).toBe('error');
		expect(planFire(['NotificationStore.x']).kind).toBe('queue');
	});

	test('--wishlist defaults to Aircar and wants a numeric appid', () => {
		expect(planFire(['--wishlist'])).toMatchObject({ kind: 'queue', command: { server: { type: 8, body: { appid: 1073390, count: 1 } } } });
		expect(planFire(['--wishlist', '570'])).toMatchObject({ kind: 'queue', command: { server: { type: 8, body: { appid: 570, count: 1 } } } });
		expect(planFire(['--wishlist', 'abc']).kind).toBe('error');
	});

	test('--server wants a numeric type and a JSON body', () => {
		expect(planFire(['--server', '3', '{"appid":570}'])).toMatchObject({ kind: 'queue', command: { server: { type: 3, body: { appid: 570 } } } });
		expect(planFire(['--server', '3'])).toMatchObject({ kind: 'queue', command: { server: { type: 3, body: {} } } });
		expect(planFire(['--server', 'x']).kind).toBe('error');
		expect(planFire(['--server', '3', '{oops']).kind).toBe('error');
		expect(planFire(['--server']).kind).toBe('error');
	});

	test('--replay takes inspect or invoke and an optional toast name', () => {
		expect(planFire(['--replay', 'inspect'])).toMatchObject({ kind: 'queue', command: { replay: { call: 'inspect' } } });
		expect(planFire(['--replay', 'invoke', 'notificationtoasts_10004_desktop'])).toMatchObject({ kind: 'queue', command: { replay: { call: 'invoke', name: 'notificationtoasts_10004_desktop' } } });
		expect(planFire(['--replay']).kind).toBe('error');
		expect(planFire(['--replay', 'delete']).kind).toBe('error');
		expect(planFire(['--replay', 'invoke', 'a"b']).kind).toBe('error');
	});

	test('--overlay-info', () => {
		expect(planFire(['--overlay-info'])).toMatchObject({ kind: 'queue', command: { overlay: { call: 'info' } } });
	});

	test('subcommands are case-sensitive and a stray dash is refused', () => {
		expect(planFire(['--Replay', 'inspect']).kind).toBe('error');
		expect(planFire(['-x']).kind).toBe('error');
	});

	test('no arguments or --help is usage', () => {
		expect(planFire([]).kind).toBe('usage');
		expect(planFire(['--help']).kind).toBe('usage');
	});

	test('token and number predicates', () => {
		expect(isToken('notificationtoasts_10004_desktop')).toBe(true);
		expect(isToken('a b')).toBe(false);
		expect(isNonNegativeInteger('1073390')).toBe(true);
		expect(isNonNegativeInteger('0')).toBe(true);
		expect(isNonNegativeInteger('9007199254740991')).toBe(true);
		// A fraction, an exponent and a literal too wide to survive JSON.parse
		// are all numbers and none of them is an appid or a type.
		expect(isNonNegativeInteger('8.5')).toBe(false);
		expect(isNonNegativeInteger('1e3')).toBe(false);
		expect(isNonNegativeInteger('1e400')).toBe(false);
		expect(isNonNegativeInteger('9007199254740993')).toBe(false);
		expect(isNonNegativeInteger('-1')).toBe(false);
		expect(isNonNegativeInteger('abc')).toBe(false);
		expect(isNonNegativeInteger('01')).toBe(false);
		expect(isNonNegativeInteger('')).toBe(false);
	});

	test('a number that is not an integer type or appid is refused, not silently mangled', () => {
		// 8.5 matches no ESteamNotificationType, 1e3 would print as 1e3 and
		// queue 1000, and 1e400 is Infinity, which JSON drops to null.
		expect(planFire(['--server', '8.5'])).toMatchObject({ kind: 'error', message: expect.stringContaining('non-negative integer') });
		expect(planFire(['--server', '1e400']).kind).toBe('error');
		expect(planFire(['--wishlist', '1e3']).kind).toBe('error');
		expect(planFire(['--wishlist', '-5']).kind).toBe('error');
	});

	test('an integer literal past 2^53 is refused, never printed as sent', () => {
		// The door's reader is a plain JSON.parse: 76561198300097684 would
		// queue as 76561198300097680 while "queued:" printed the real digits.
		const wide = '76561198300097684';
		// One matcher per object: bun's toMatchObject writes an asymmetric
		// matcher back into the received object, so a second look at .message
		// would see the matcher, not the string.
		const refused = { kind: 'error', message: expect.stringMatching(new RegExp(`${wide}.*pass it as a string`)) };
		expect(planFire(['TestFriendMessage', wide, '"hi"'])).toMatchObject(refused);
		expect(planFire(['--server', '9', `{"sender":{"id":[1,${wide}]}}`])).toMatchObject(refused);
		// As a string it is exact and goes through.
		expect(planFire(['TestFriendMessage', `"${wide}"`, '"hi"'])).toMatchObject({ kind: 'queue', command: { call: 'TestFriendMessage', args: [wide, 'hi'] } });
		expect(planFire(['--server', '9', `{"sender":"${wide}"}`])).toMatchObject({ kind: 'queue', command: { server: { type: 9, body: { sender: wide } } } });
		// Safe integers still pass as numbers, exactly.
		expect(planFire(['TestAchievement', '570'])).toMatchObject({ kind: 'queue', command: { call: 'TestAchievement', args: [570] } });
	});

	test('an empty argument is the value it looks like, not a missing one', () => {
		// An empty entry makes [,"hi"], which is not JSON; refusing before the
		// write says so instead of printing "queued".
		expect(planFire(['TestFriendMessage', '', '"hi"'])).toMatchObject({ kind: 'error', message: expect.stringContaining('JSON literals') });
		expect(planFire([''])).toMatchObject({ kind: 'error', message: expect.stringContaining('method name') });
		// A subcommand slot with a default takes it on an empty argument.
		expect(planFire(['--wishlist', ''])).toMatchObject({ kind: 'queue', command: { server: { type: 8, body: { appid: 1073390, count: 1 } } } });
		expect(planFire(['--server', '3', ''])).toMatchObject({ kind: 'queue', command: { server: { type: 3, body: {} } } });
		expect(planFire(['--replay', 'invoke', ''])).toEqual({ kind: 'queue', command: { replay: { call: 'invoke' } }, message: expect.stringContaining("'(latest)'") });
		// A slot without a default reads an empty argument as missing.
		expect(planFire(['--server', '']).kind).toBe('error');
		expect(planFire(['--replay', '']).kind).toBe('error');
	});
});
