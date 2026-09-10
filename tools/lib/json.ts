// JSON with exact integers. A steamid64 is 17 digits, wider than JavaScript's
// safe integer range, and JSON.parse rounds any literal past 2^53 to the
// nearest double: 76561198300097684 comes back as 76561198300097680. The
// reviver's source-text context (ES2025) keeps such literals as bigints, and
// JSON.rawJSON prints a bigint back as the same digits. Bun has both from
// 1.1.43, the engines floor in package.json;
// TypeScript 5.9's lib does not declare them yet, hence the typed view below.
const json = JSON as unknown as {
	parse(text: string, reviver: (this: unknown, key: string, value: unknown, context: { source?: string }) => unknown): unknown;
	rawJSON(text: string): unknown;
};

const INTEGER = /^-?\d+$/;

/** JSON.parse, except that an integer literal outside the safe range is a bigint rather than a rounded number. */
export function parseJson(text: string): unknown {
	return json.parse(text, function (_key, value, context) {
		if (typeof value === 'number' && !Number.isSafeInteger(value) && context.source !== undefined && INTEGER.test(context.source)) return BigInt(context.source);
		return value;
	});
}

/** JSON.stringify at two-space indentation, with bigints printed as integer literals. */
export function formatJson(value: unknown): string {
	return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? json.rawJSON(v.toString()) : v), 2);
}
