// The msgpack subset Millennium's external protocol speaks: nil, booleans,
// integers, floats, strings, binary, arrays and maps. No extension types.
// Decoding is exact: a value must end where the frame ends, and a frame
// that ends early is an error, never a partial answer.

export type Packable = null | boolean | number | bigint | string | Uint8Array | Packable[] | { [key: string]: Packable };

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

class Writer {
	private chunks: Uint8Array[] = [];
	private size = 0;
	bytes(...b: number[]): void {
		this.push(Uint8Array.from(b));
	}
	push(u: Uint8Array): void {
		this.chunks.push(u);
		this.size += u.length;
	}
	finish(): Uint8Array {
		const out = new Uint8Array(this.size);
		let i = 0;
		for (const c of this.chunks) {
			out.set(c, i);
			i += c.length;
		}
		return out;
	}
}

// The length ladder every container shares: a fix form up to fixMax (none
// when fixMax is -1), then the 8-bit type when there is one, 16, 32.
function writeLen(w: Writer, n: number, fixMask: number, fixMax: number, t8: number | null, t16: number, t32: number): void {
	if (n <= fixMax) w.bytes(fixMask | n);
	else if (t8 !== null && n < 0x100) w.bytes(t8, n);
	else if (n < 0x10000) w.bytes(t16, n >>> 8, n & 0xff);
	else w.bytes(t32, n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

function encodeInto(w: Writer, v: Packable): void {
	if (v === null || v === undefined) return w.bytes(0xc0);
	if (v === true) return w.bytes(0xc3);
	if (v === false) return w.bytes(0xc2);
	if (typeof v === 'bigint') {
		if (v >= 0n && v <= 0xffffffffffffffffn) {
			const b = new Uint8Array(9);
			b[0] = 0xcf;
			new DataView(b.buffer).setBigUint64(1, v);
			return w.push(b);
		}
		if (v >= -(2n ** 63n) && v < 2n ** 63n) {
			const b = new Uint8Array(9);
			b[0] = 0xd3;
			new DataView(b.buffer).setBigInt64(1, v);
			return w.push(b);
		}
		throw new Error('msgpack: bigint out of 64-bit range');
	}
	if (typeof v === 'number') {
		// Safe integers take the integer ladder, and every one of them fits a
		// 64-bit rung. A double that is integral but larger (1e20, 2 ** 64) has
		// no exact integer encoding at all, so it goes out as float64.
		if (Number.isSafeInteger(v)) {
			if (v >= 0 && v <= 0x7f) return w.bytes(v);
			if (v < 0 && v >= -32) return w.bytes(0x100 + v);
			if (v >= 0) {
				if (v <= 0xff) return w.bytes(0xcc, v);
				if (v <= 0xffff) return w.bytes(0xcd, v >>> 8, v & 0xff);
				if (v <= 0xffffffff) return w.bytes(0xce, v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
				return encodeInto(w, BigInt(v));
			}
			if (v >= -0x80) return w.bytes(0xd0, v & 0xff);
			if (v >= -0x8000) return w.bytes(0xd1, (v >> 8) & 0xff, v & 0xff);
			if (v >= -0x80000000) return w.bytes(0xd2, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
			return encodeInto(w, BigInt(v));
		}
		const b = new Uint8Array(9);
		b[0] = 0xcb;
		new DataView(b.buffer).setFloat64(1, v);
		return w.push(b);
	}
	if (typeof v === 'string') {
		const b = utf8.encode(v);
		writeLen(w, b.length, 0xa0, 31, 0xd9, 0xda, 0xdb);
		return w.push(b);
	}
	if (v instanceof Uint8Array) {
		writeLen(w, v.length, 0, -1, 0xc4, 0xc5, 0xc6);
		return w.push(v);
	}
	if (Array.isArray(v)) {
		writeLen(w, v.length, 0x90, 15, null, 0xdc, 0xdd);
		for (const item of v) encodeInto(w, item);
		return;
	}
	if (typeof v === 'object') {
		const keys = Object.keys(v);
		writeLen(w, keys.length, 0x80, 15, null, 0xde, 0xdf);
		for (const k of keys) {
			encodeInto(w, k);
			encodeInto(w, v[k]);
		}
		return;
	}
	throw new Error(`msgpack: cannot encode ${typeof v}`);
}

export function encode(v: Packable): Uint8Array {
	const w = new Writer();
	encodeInto(w, v);
	return w.finish();
}

class Reader {
	pos = 0;
	private view: DataView;
	constructor(private buf: Uint8Array) {
		this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	}
	get remaining(): number {
		return this.buf.length - this.pos;
	}
	private need(n: number): void {
		if (this.pos + n > this.buf.length) throw new Error(`msgpack: truncated value (needed ${n} more bytes at ${this.pos})`);
	}
	u8(): number {
		this.need(1);
		return this.buf[this.pos++];
	}
	u16(): number {
		this.need(2);
		const v = this.view.getUint16(this.pos);
		this.pos += 2;
		return v;
	}
	u32(): number {
		this.need(4);
		const v = this.view.getUint32(this.pos);
		this.pos += 4;
		return v;
	}
	i8(): number {
		this.need(1);
		return this.view.getInt8(this.pos++);
	}
	i16(): number {
		this.need(2);
		const v = this.view.getInt16(this.pos);
		this.pos += 2;
		return v;
	}
	i32(): number {
		this.need(4);
		const v = this.view.getInt32(this.pos);
		this.pos += 4;
		return v;
	}
	big(signed: boolean): number | bigint {
		this.need(8);
		const v = signed ? this.view.getBigInt64(this.pos) : this.view.getBigUint64(this.pos);
		this.pos += 8;
		return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
	}
	f32(): number {
		this.need(4);
		const v = this.view.getFloat32(this.pos);
		this.pos += 4;
		return v;
	}
	f64(): number {
		this.need(8);
		const v = this.view.getFloat64(this.pos);
		this.pos += 8;
		return v;
	}
	slice(n: number): Uint8Array {
		this.need(n);
		const s = this.buf.subarray(this.pos, this.pos + n);
		this.pos += n;
		return s;
	}
	str(n: number): string {
		return utf8Decoder.decode(this.slice(n));
	}
	array(n: number): unknown[] {
		const a: unknown[] = [];
		for (let i = 0; i < n; i++) a.push(this.value());
		return a;
	}
	map(n: number): Record<string, unknown> {
		const m: Record<string, unknown> = {};
		for (let i = 0; i < n; i++) {
			const k = this.value();
			m[typeof k === 'string' ? k : String(k)] = this.value();
		}
		return m;
	}
	value(): unknown {
		const t = this.u8();
		if (t <= 0x7f) return t;
		if (t >= 0xe0) return t - 0x100;
		if ((t & 0xe0) === 0xa0) return this.str(t & 0x1f);
		if ((t & 0xf0) === 0x90) return this.array(t & 0x0f);
		if ((t & 0xf0) === 0x80) return this.map(t & 0x0f);
		switch (t) {
			case 0xc0: return null;
			case 0xc2: return false;
			case 0xc3: return true;
			case 0xc4: return this.slice(this.u8());
			case 0xc5: return this.slice(this.u16());
			case 0xc6: return this.slice(this.u32());
			case 0xca: return this.f32();
			case 0xcb: return this.f64();
			case 0xcc: return this.u8();
			case 0xcd: return this.u16();
			case 0xce: return this.u32();
			case 0xcf: return this.big(false);
			case 0xd0: return this.i8();
			case 0xd1: return this.i16();
			case 0xd2: return this.i32();
			case 0xd3: return this.big(true);
			case 0xd9: return this.str(this.u8());
			case 0xda: return this.str(this.u16());
			case 0xdb: return this.str(this.u32());
			case 0xdc: return this.array(this.u16());
			case 0xdd: return this.array(this.u32());
			case 0xde: return this.map(this.u16());
			case 0xdf: return this.map(this.u32());
			default:
				throw new Error(`msgpack: unsupported type byte 0x${t.toString(16).padStart(2, '0')}`);
		}
	}
}

/**
 * Decode exactly one value spanning the whole buffer. Bytes left over are an
 * error (a second value concatenated onto the first, or a length prefix that
 * lied), and a buffer that ends inside a value is an error too.
 */
export function decode(buf: Uint8Array): unknown {
	const r = new Reader(buf);
	const v = r.value();
	if (r.remaining !== 0) throw new Error(`msgpack: ${r.remaining} trailing byte(s) after the value`);
	return v;
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
