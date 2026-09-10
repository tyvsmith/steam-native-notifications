// tools/mep, minus the usage header that stays in the entrypoint
// (usageFromHeader reads it from there).
import { formatJson } from '../json';
import { type Reply, USEFUL_MEP_METHODS, mepCall, parseMepParam } from '../mep';
import { type Packable } from '../msgpack';
import { usageFromHeader } from '../snn';

// `entry` is the extensionless entrypoint that imported this module.
export async function main(entry: string): Promise<void> {

	function fail(message: string): never {
		console.error(message);
		process.exit(1);
	}

	const argv = process.argv.slice(2);
	if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
		console.log(usageFromHeader(entry));
		process.exit(0);
	}
	if (argv[0] === '--methods') {
		console.log(USEFUL_MEP_METHODS.map((m) => `  ${m}`).join('\n'));
		process.exit(0);
	}
	const params: Record<string, Packable> = {};
	for (const token of argv.slice(1)) {
		try {
			const [k, v] = parseMepParam(token);
			params[k] = v;
		} catch (e) {
			fail((e as Error).message);
		}
	}
	let reply: Reply;
	try {
		reply = await mepCall(argv[0], params);
	} catch (e) {
		fail((e as Error).message);
	}
	console.log(formatJson(reply));
	// Millennium answers every call with both keys: a success carries
	// `error: null` and the answer in `result`, a failure carries the message in
	// `error` and `result: null`. So it is the error's presence as a value, not
	// its truthiness, that decides -- an empty map or a zero in there is still an
	// error, and only null (or no key at all) is not.
	process.exit(reply.error != null ? 1 : 0);
}
