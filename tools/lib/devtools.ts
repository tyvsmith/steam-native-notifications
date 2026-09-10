// The pure halves of tools/fire and tools/mep, kept apart from the file and
// socket work so tools/devtools.test.ts can pin their contracts.
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
	| { replay: { call: 'inspect' | 'invoke'; name?: string } };

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

/** key=value; the value is JSON when it parses as JSON, else a plain string. */
export function parseMepParam(token: string): [string, unknown] {
	const eq = token.indexOf('=');
	if (eq < 0) throw new Error(`parameters look like key=value, got: ${token}`);
	const key = token.slice(0, eq);
	const raw = token.slice(eq + 1);
	try {
		return [key, parseJson(raw)];
	} catch {
		return [key, raw];
	}
}

export const USEFUL_MEP_METHODS = [
	'millennium.version', 'millennium.status',
	'plugin.list', 'plugin.get', 'plugin.status',
	'plugin.enable', 'plugin.disable', 'plugin.restart',
	'plugin.config.get', 'plugin.config.set',
	'plugin.config.delete', 'plugin.config.get_all',
];

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
