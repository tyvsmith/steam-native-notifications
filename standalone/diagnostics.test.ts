import { expect, test } from 'bun:test';
import { inspectEndpoint, parseListeners, type Listener } from './diagnostics';
const target = { type: 'page', title: 'SharedJSContext', url: 'https://steamloopback.host/sharedjscontext.html', webSocketDebuggerUrl: 'ws://127.0.0.1:8080/devtools/page/1' };
const listener: Listener = { address: '0100007F', inode: '123', loopback: true };
function dependencies(active: Listener[], owned = true, body: unknown = [target]) {
    return { listeners: async () => active, steamOwner: async () => owned, fetch: (async () => Response.json(body)) as unknown as typeof fetch };
}
test('Linux listener parsing distinguishes wildcard, IPv4/IPv6 loopback and connected sockets', () => {
    const row = (address: string, state = '0A') => ` 0: ${address}:1F90 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000 1000 0 123`;
    expect(parseListeners('header\n' + row('0100007F'), 8080)).toEqual([listener]);
    expect(parseListeners('header\n' + row('00000000'), 8080)[0]?.loopback).toBe(false);
    expect(parseListeners('header\n' + row('00000000000000000000000001000000'), 8080, true)[0]?.loopback).toBe(true);
    expect(parseListeners('header\n' + row('0100007F', '01'), 8080)).toEqual([]);
    expect(parseListeners('header\n' + row('0100007F'), 9000)).toEqual([]);
});
test('status differentiates missing endpoint, unsafe bind, wrong owner, wrong target and ready discovery', async () => {
    expect((await inspectEndpoint(8080, dependencies([]))).kind).toBe('missing');
    expect((await inspectEndpoint(8080, dependencies([{ ...listener, loopback: false }]))).kind).toBe('unsafe');
    expect((await inspectEndpoint(8080, dependencies([listener], false))).message).toContain('conflict');
    expect((await inspectEndpoint(8080, dependencies([listener], true, [{ ...target, title: 'Other browser' }]))).message).toContain('no valid Steam');
    expect((await inspectEndpoint(8080, dependencies([listener]))).kind).toBe('steam');
});
test('discovery is bounded, refuses redirects and reports malformed/HTTP errors', async () => {
    let options: RequestInit | undefined;
    const deps = dependencies([listener]);
    deps.fetch = (async (_url: unknown, init: RequestInit) => { options = init; return new Response('no', { status: 403 }); }) as unknown as typeof fetch;
    expect((await inspectEndpoint(8080, deps)).message).toContain('HTTP 403');
    expect(options?.redirect).toBe('error'); expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect((await inspectEndpoint(8080, dependencies([listener], true, {}))).kind).toBe('conflict');
});
