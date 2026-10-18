import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { FFIType } from 'bun:ffi';
import { waylandAvailable } from './dependencies';

test('Wayland probe resolves a real symbol and closes without calling it', () => {
    let closed = false;
    expect(waylandAvailable((library, symbols) => {
        expect(library).toBe('libwayland-client.so.0');
        expect(symbols).toEqual({ wl_display_disconnect: { args: [FFIType.ptr], returns: FFIType.void } });
        return { close() { closed = true; } };
    })).toBe(true);
    expect(closed).toBe(true);
});

test('missing Wayland library reports degraded availability without throwing', () => {
    expect(waylandAvailable(() => { throw new Error('library not found'); })).toBe(false);
});

const installed = ['/usr/lib/libwayland-client.so.0', '/usr/lib/x86_64-linux-gnu/libwayland-client.so.0', '/lib/x86_64-linux-gnu/libwayland-client.so.0'].some(existsSync);
test.skipIf(!installed)('installed Wayland library loads using pinned Bun FFI', () => {
    expect(waylandAvailable()).toBe(true);
});
