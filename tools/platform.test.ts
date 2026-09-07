import { expect, mock, test } from 'bun:test';

let reply: unknown;
let calls = 0;
mock.module('millennium', () => ({
	ffi: () => async () => { calls++; if (reply instanceof Error) throw reply; return reply; },
}));
const { loadPlatform } = await import('../frontend/platform');

test('platform discovery retries unavailable responses and caches a confirmed platform', async () => {
	for (reply of [undefined, null, {}, 'other', '"broken', new Error('backend not ready')]) {
		expect(await loadPlatform()).toBe('unknown');
	}
	reply = new Promise(() => {});
	expect(await loadPlatform()).toBe('unknown');
	reply = 'linux';
	const first = loadPlatform();
	expect(loadPlatform()).toBe(first);
	expect(await first).toBe('linux');
	reply = 'windows';
	expect(await loadPlatform()).toBe('linux');
	expect(calls).toBe(8);
});
