// tools/fire's argument grammar, kept apart from the file work so
// tools/devtools.test.ts can pin its contract.
import { parseJson } from './json';

/** What a dev-door name may look like: a NotificationStore Test* method, a toast name, a replay call. */
export function isToken(s: string): boolean {
	return /^[A-Za-z0-9_.-]+$/.test(s);
}

/**
 * An appid and an ESteamNotificationType are both non-negative integers, so
 * that is the domain, not "a JSON number": a fraction or an exponent parses
 * fine and then means nothing to Steam. The safe-integer bound keeps the text
 * this tool prints equal to the value it queues, which a 20-digit literal
 * would not be once JSON.parse rounds it.
 */
export function isNonNegativeInteger(s: string): boolean {
	return /^(0|[1-9]\d*)$/.test(s) && Number.isSafeInteger(Number(s));
}

const QUEUED = '(needs the tools/fire toggle on in the plugin settings; picked up within ~3s)';

/** One dev-door command, the shape frontend/devfire.ts reads back. */
export type DevCommand =
	| { call: string; args: unknown[] }
	| { server: { type: number; body: unknown } }
	| { overlay: { call: 'info' } }
	| { replay: { call: 'inspect' | 'invoke'; name?: string } }
	| { focus: { appid: number } };

export type FirePlan =
	| { kind: 'usage' }
	| { kind: 'error'; message: string }
	| { kind: 'queue'; command: DevCommand; message: string };

/**
 * tools/fire's argument grammar, exactly as the shell tool took it. Names are
 * checked: everything the doors accept is an identifier, and anything else
 * is a typo or an injection into Steam's own lookup, refused here before
 * anything is written. Subcommands match case-sensitively; a dash-led first
 * argument that is not one of them is refused, since no NotificationStore
 * method starts with a dash. Call arguments are JSON literals by contract,
 * and the whole argument list must parse before anything is written, so
 * "queued" is never printed for a command the frontend would drop. An empty
 * argument counts: in a subcommand slot that has a default it means "take the
 * default", and everywhere else it is the value it looks like -- an empty
 * method name, or an empty call argument, which is not a JSON literal.
 * Integer literals past the safe range are refused outright: the door's
 * reader (frontend/settings.ts parseCallableJson) is a plain JSON.parse
 * that would round them, so queueing one means printing digits that were
 * never sent. A steamid goes through as a string.
 */
/**
 * JSON for a dev-door value: parsed exactly, then refused if any integer
 * literal in it lies outside the safe range, since the door cannot carry it.
 * Throws with the offending literal on a refusal, and a SyntaxError on
 * malformed text, like JSON.parse.
 */
export function parseDoorJson(text: string): unknown {
	const value = parseJson(text);
	const wide = findBigInt(value);
	if (wide !== null) throw new RangeError(`${wide} is wider than 2^53 and the dev door would round it; pass it as a string ("${wide}")`);
	return value;
}

function findBigInt(v: unknown): bigint | null {
	if (typeof v === 'bigint') return v;
	if (Array.isArray(v)) {
		for (const item of v) {
			const hit = findBigInt(item);
			if (hit !== null) return hit;
		}
		return null;
	}
	if (v && typeof v === 'object') {
		for (const item of Object.values(v)) {
			const hit = findBigInt(item);
			if (hit !== null) return hit;
		}
	}
	return null;
}

export function planFire(argv: string[]): FirePlan {
	if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') return { kind: 'usage' };
	const [head, ...rest] = argv;

	if (head === '--wishlist') {
		const appid = rest[0] || '1073390';
		if (!isNonNegativeInteger(appid)) return { kind: 'error', message: `an appid must be a non-negative integer, got: ${appid}` };
		return {
			kind: 'queue',
			command: { server: { type: 8, body: { appid: JSON.parse(appid), count: 1 } } },
			message: `queued: server Wishlist appid=${appid}  ${QUEUED}`,
		};
	}
	if (head === '--overlay-info') {
		return { kind: 'queue', command: { overlay: { call: 'info' } }, message: 'queued: overlay info  (result lands in the plugin log)' };
	}
	if (head === '--focus') {
		const appid = rest[0];
		if (!appid) return { kind: 'error', message: '--focus needs the appid to ask about' };
		if (!isNonNegativeInteger(appid) || appid === '0') return { kind: 'error', message: `an appid must be a positive integer, got: ${appid}` };
		return { kind: 'queue', command: { focus: { appid: JSON.parse(appid) } }, message: `queued: focus probe appid=${appid}  (result lands in the plugin log as focus-host:)` };
	}
	if (head === '--replay') {
		const call = rest[0];
		if (!call) return { kind: 'error', message: '--replay needs a call (inspect or invoke)' };
		if (call !== 'inspect' && call !== 'invoke') return { kind: 'error', message: `--replay call must be inspect or invoke, got: ${call}` };
		const name = rest[1] || '';
		if (name && !isToken(name)) return { kind: 'error', message: `a toast name must match [A-Za-z0-9_.-], got: ${name}` };
		return {
			kind: 'queue',
			command: { replay: name ? { call, name } : { call } },
			message: `queued: replay ${call} ${name || "'(latest)'"}  (result lands in the plugin log)`,
		};
	}
	if (head === '--server') {
		const type = rest[0];
		if (!type) return { kind: 'error', message: '--server needs a numeric ESteamNotificationType' };
		if (!isNonNegativeInteger(type)) return { kind: 'error', message: `a notification type must be a non-negative integer, got: ${type}` };
		const body = rest[1] || '{}';
		let parsed: unknown;
		try {
			parsed = parseDoorJson(body);
		} catch (e) {
			if (e instanceof RangeError) return { kind: 'error', message: `--server body: ${e.message}` };
			return { kind: 'error', message: `--server body must be JSON, got: ${body}` };
		}
		return {
			kind: 'queue',
			command: { server: { type: JSON.parse(type), body: parsed } },
			message: `queued: server type=${type} body=${body}  ${QUEUED}`,
		};
	}
	if (head.startsWith('-')) {
		return { kind: 'error', message: `unknown subcommand: ${head}\nsubcommands are case-sensitive; tools/fire --help lists them` };
	}
	if (!isToken(head)) return { kind: 'error', message: `a method name must match [A-Za-z0-9_.-], got: ${head}` };
	const list = `[${rest.join(',')}]`;
	let args: unknown[];
	try {
		args = parseDoorJson(list) as unknown[];
	} catch (e) {
		if (e instanceof RangeError) return { kind: 'error', message: `call arguments: ${e.message}` };
		return { kind: 'error', message: `call arguments must be JSON literals (quote strings), got: ${list}` };
	}
	return { kind: 'queue', command: { call: head, args }, message: `queued: ${head} ${list}  ${QUEUED}` };
}
