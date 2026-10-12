import { dlopen, FFIType } from 'bun:ffi';

// Resolve the documented client API, but never call it or connect to a compositor.
const waylandSymbols = { wl_display_disconnect: { args: [FFIType.ptr], returns: FFIType.void } } as const;
type LibraryProbe = (library: string, symbols: typeof waylandSymbols) => { close(): void };
export function waylandAvailable(load: LibraryProbe = dlopen): boolean {
    try {
        const library = load('libwayland-client.so.0', waylandSymbols);
        library.close();
        return true;
    } catch { return false; }
}
export function dependencies() {
    const required = Object.fromEntries(['notify-send', 'gdbus', 'curl'].map(name => [name, !!Bun.which(name)]));
    const wayland = waylandAvailable();
    const luajit = !!Bun.which('luajit');
    return { required, optional: { luajit, libwayland: wayland }, delivery: Object.values(required).every(Boolean) ? 'available' : 'missing-dependencies', focus: luajit && wayland ? 'available' : 'degraded-unknown' };
}
