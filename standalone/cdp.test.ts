import { expect, test } from 'bun:test';
import { CDP, endpoint, targetSocket } from './cdp';
import { attach as attachHost, connectSteamContext } from './daemon';
const attach: typeof attachHost = (client, bundle, host, ...rest) => {
    (host as any).store ??= { read: async () => ({ values: await host.settings(), error: null as string | null }), subscribe: async () => () => {} };
    return attachHost(client, bundle, host, ...rest);
};
const target = { type: 'page', title: 'SharedJSContext', url: 'https://steamloopback.host/index.html', webSocketDebuggerUrl: 'ws://localhost:8080/devtools/page/1' };
test('target selection accepts Steam UI only and pins websocket to loopback', () => {
    expect(targetSocket(target, 8080)).toBe('ws://127.0.0.1:8080/devtools/page/1');
    for (const wrong of [{ title: 'Store' }, { url: 'https://store.steampowered.com/index.html' }, { webSocketDebuggerUrl: 'ws://example.com:8080/page' }, { webSocketDebuggerUrl: 'ws://127.0.0.1:7777/page' }, { type: 'worker' }, { url: 'https://steamloopback.host/checkout.html' }]) expect(targetSocket({ ...target, ...wrong }, 8080)).toBeNull();
    expect(() => endpoint(0)).toThrow(); expect(() => endpoint(NaN)).toThrow();
});
test('CDP correlates out-of-order replies, reports errors, rejects requests on close', async () => {
    const messages: any[] = []; let socket: any;
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(request, server) { if (server.upgrade(request)) return undefined; return new Response('no'); },
        websocket: { open(ws) { socket = ws; }, message(_ws, data) { messages.push(JSON.parse(String(data))); } } });
    const client = await CDP.connect(`ws://127.0.0.1:${server.port}/`);
    try {
        const first = client.call('first'); const second = client.call('second');
        while (messages.length < 2) await Bun.sleep(5);
        socket.send(JSON.stringify({ id: messages[1].id, result: { value: 2 } }));
        socket.send(JSON.stringify({ id: messages[0].id, result: { value: 1 } }));
        expect((await first).value).toBe(1); expect((await second).value).toBe(2);
        const rejected = client.call('bad').catch(error => error);
        while (messages.length < 3) await Bun.sleep(5);
        socket.send(JSON.stringify({ id: messages[2].id, error: { message: 'bad method' } })); expect((await rejected).message).toBe('bad method');
        const closed = client.call('pending').catch(error => error); client.close(); expect((await closed).message).toContain('disconnected');
    } finally { client.close(); server.stop(true); }
});
test('attach waits for the default Steam context, bridges RPC, and reinjects after reload', async () => {
    let running = true; const calls: any[] = []; const logs: string[] = []; let injections = 0;
    const client: any = { onEvent: (_event: any) => {}, closed: new Promise(() => {}), async call(method: string, params: any) {
        calls.push({ method, params });
        if (method === 'Runtime.enable') this.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 1, auxData: { isDefault: true } } } });
        if (params?.expression?.startsWith('Boolean')) return { result: { value: true } };
        if (params?.expression?.includes('fixture bundle')) {
            injections++;
            if (injections === 1) {
                this.onEvent({ method: 'Runtime.bindingCalled', params: { name: '__snnHost', executionContextId: 99, payload: '{"id":1,"method":"Notify","args":[]}' } });
                this.onEvent({ method: 'Runtime.bindingCalled', params: { name: '__snnHost', executionContextId: 1, payload: '{"id":2,"method":"Platform","args":[]}' } });
                setTimeout(() => {
                    this.onEvent({ method: 'Runtime.executionContextsCleared' });
                    this.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 2, auxData: { isDefault: true } } } });
                }, 10);
            } else running = false;
        }
        return {};
    } };
    const methods: string[] = [];
    const host: any = { live: { state: 'disconnected' }, readiness: async () => {}, settings: async () => ({ devFire: false }), log: async (line: string) => { logs.push(line); }, dispatch: async (method: string) => { methods.push(method); return 'linux'; } };
    await attach(client, '/* fixture bundle */', host, () => running);
    expect(injections).toBe(2); expect(methods).toEqual(['Platform']);
    expect(logs.length).toBe(1);
    expect(calls.some(call => call.params?.expression?.includes('__snnReply(2,"linux"'))).toBe(true);
});


test('discovery prefers shared context over extra main UI targets and probes fallbacks', async () => {
    const connected: string[] = [];
    const connect: any = async (url: string) => {
        connected.push(url);
        return { onEvent: (_event: any) => {}, close() {}, async call(method: string) {
            if (method === 'Runtime.enable') this.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 1, auxData: { isDefault: true } } } });
            return { result: { value: !url.endsWith('/bad') } };
        } };
    };
    const main = { ...target, title: 'Steam', webSocketDebuggerUrl: 'ws://localhost:8080/devtools/page/main' };
    const selected = await connectSteamContext([main, target], 8080, connect);
    expect(selected.contexts).toEqual([1]); expect(connected).toEqual(['ws://127.0.0.1:8080/devtools/page/1']);
    connected.length = 0;
    await connectSteamContext([{ ...target, webSocketDebuggerUrl: 'ws://localhost:8080/bad' }, main], 8080, connect);
    expect(connected).toEqual(['ws://127.0.0.1:8080/bad', 'ws://127.0.0.1:8080/devtools/page/main']);
});
test('discovery refuses two ready shared targets and closes both connections', async () => {
    let closed = 0;
    const connect: any = async () => ({ onEvent: (_event: any) => {}, close() { closed++; }, async call(method: string) {
        if (method === 'Runtime.enable') this.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 1, auxData: { isDefault: true } } } });
        return { result: { value: true } };
    } });
    const error = await connectSteamContext([target, target], 8080, connect).catch(error => error);
    expect(error.message).toContain('ambiguous'); expect(closed).toBe(2);
});
test('reload during awaited injection cannot mark a destroyed context attached', async () => {
    let running = true; let injections = 0; const ids: number[] = [];
    const client: any = { onEvent: (_event: any) => {}, closed: new Promise(() => {}), async call(method: string, params: any) {
        if (method === 'Runtime.enable') this.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 1, auxData: { isDefault: true } } } });
        if (params?.expression?.startsWith('Boolean')) return { result: { value: true } };
        if (params?.expression?.includes('race bundle')) {
            ids.push(params.contextId); injections++;
            if (injections === 1) {
                this.onEvent({ method: 'Runtime.executionContextsCleared' });
                this.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 2, auxData: { isDefault: true } } } });
                await Bun.sleep(10);
            } else running = false;
        }
        return {};
    } };
    const host: any = { live: { state: 'disconnected' }, readiness: async () => {}, settings: async () => ({}), log: async () => {}, dispatch: async () => 'ok' };
    await attach(client, '/* race bundle */', host, () => running);
    expect(ids).toEqual([1, 2]);
}, 4000);

test('idle attachment makes no repeated reads or CDP calls; context lifecycle and disconnect clean up', async () => {
    let close!: () => void, notify!: () => void, unsubscribed = false;
    let reads = 0, calls = 0, attached = 0;
    const client: any = { onEvent() {}, closed: new Promise<void>(resolve => { close = resolve; }), async call(method: string, params: any) {
        calls++;
        if (method === 'Runtime.enable') this.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 1, auxData: { isDefault: true } } } });
        if (params?.expression?.includes('fixture bundle')) attached++;
        return { result: { value: true } };
    } };
    const host: any = { live: {}, log: async () => {}, settings: async () => { reads++; return {}; }, readiness: async () => {},
        store: { read: async () => { reads++; return { values: {}, error: null as string | null }; }, subscribe: async (fn: any) => { notify = fn; return () => { unsubscribed = true; }; } } };
    const pending = attach(client, '/* fixture bundle */', host).catch(error => error);
    while (!host.frontendCommand || !attached) await Bun.sleep(1);
    await Bun.sleep(10);
    const before = { calls, reads };
    await Bun.sleep(1100); expect({ calls, reads }).toEqual(before);
    notify(); await Bun.sleep(10); expect(reads).toBe(before.reads + 1);
    client.onEvent({ method: 'Runtime.executionContextsCleared' }); expect(host.frontendCommand).toBeUndefined();
    client.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 2, auxData: { isDefault: true } } } });
    await Bun.sleep(10); expect(attached).toBe(2);
    close(); expect((await pending).message).toContain('disconnected');
    expect(unsubscribed).toBe(true); expect(host.refreshFrontend).toBeUndefined();
    const after = calls; client.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 3, auxData: { isDefault: true } } } });
    await Bun.sleep(10); expect(calls).toBe(after);
});

test('context replacement during a command settings read refuses stale dispatch', async () => {
    let close!: () => void, replace = false, commands = 0;
    const client: any = { onEvent() {}, closed: new Promise<void>(resolve => { close = resolve; }), async call(method: string, params: any) {
        if (method === 'Runtime.enable') this.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 1, auxData: { isDefault: true } } } });
        if (params?.expression?.includes('globalThis.__snnDevControl ?')) commands++;
        return { result: { value: true } };
    } };
    const host: any = { live: {}, log: async () => {}, async settings() { if (replace) client.onEvent({ method: 'Runtime.executionContextsCleared' }); return {}; }, readiness: async () => {} };
    const pending = attach(client, '/* fixture */', host).catch(error => error);
    while (!host.frontendCommand) await Bun.sleep(1);
    const command = host.frontendCommand; replace = true;
    await expect(command({ deadline: Date.now() + 2000 }, true)).rejects.toThrow('Frontend changed');
    expect(commands).toBe(0); close(); await pending;
});

for (const outcome of ['accepted', 'expired', 'exception', 'failed', 'outdated'] as const) test(`panel removal waits for successful reply acceptance: ${outcome}`, async () => {
    let running = true; const events: string[] = [];
    const client: any = { onEvent() {}, closed: new Promise(() => {}), async call(_method: string, params: any) {
        if (params?.expression?.startsWith('Boolean')) return { result: { value: true } };
        if (params?.expression === "typeof globalThis.__snnRemove === 'function'") return { result: { value: outcome !== 'outdated' } };
        if (params?.expression?.includes('removal fixture')) this.onEvent({ method: 'Runtime.bindingCalled', params: { name: '__snnHost', executionContextId: 1, payload: JSON.stringify({ id: 5, method: 'PanelRemove', args: [] }) } });
        if (params?.expression?.replace(/^globalThis\.__snnRemove\(\);/, '').startsWith("typeof globalThis.__snnReply")) {
            expect(params.expression.includes('globalThis.__snnRemove();')).toBe(outcome !== 'failed' && outcome !== 'outdated');
            events.push('reply');
            await Promise.resolve();
            expect(events).not.toContain('stop');
            running = false;
            return outcome === 'exception' ? { exceptionDetails: { text: 'context lost' } } : { result: { value: outcome !== 'expired' } };
        }
        return {};
    } };
    const host: any = { live: {}, readiness: async () => {}, settings: async () => ({}), log: async () => {},
        dispatch: async () => { events.push('cleanup'); if (outcome === 'failed') throw Error('cleanup failed'); return '{"ok":true}'; },
        removal: { acknowledged: () => { events.push('stop'); } } };
    await attach(client, '/* removal fixture */', host, () => running, [1]);
    expect(events).toEqual(outcome === 'accepted' ? ['cleanup', 'reply', 'stop'] : outcome === 'outdated' ? ['reply'] : ['cleanup', 'reply']);
});

test('on-demand health replaces remembered ready state when the renderer stops responding', async () => {
    let close!: () => void, broken = false;
    const client: any = { onEvent() {}, closed: new Promise<void>(resolve => { close = resolve; }), async call(method: string) {
        if (method === 'Runtime.enable') this.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 1, auxData: { isDefault: true } } } });
        if (broken) throw new Error('renderer unresponsive');
        return { result: { value: true } };
    } };
    const host: any = { live: {}, log: async () => {}, settings: async () => ({}), readiness: async () => {} };
    const pending = attach(client, '/* fixture */', host).catch(error => error);
    while (host.live.state !== 'ready') await Bun.sleep(1);
    broken = true; await host.refreshFrontend();
    expect(host.live.state).toBe('unresponsive'); expect(host.live.control).toBe(false);
    close(); await pending;
});

test('destroying the selected context injects an already discovered replacement', async () => {
    let close!: () => void; const injections: number[] = [];
    const client: any = { onEvent() {}, closed: new Promise<void>(resolve => { close = resolve; }), async call(_method: string, params: any) {
        if (params?.expression?.includes('replacement fixture')) injections.push(params.contextId);
        return { result: { value: true } };
    } };
    const host: any = { live: {}, log: async () => {}, settings: async () => ({}), readiness: async () => {} };
    const pending = attach(client, '/* replacement fixture */', host, () => true, [1, 2]).catch(error => error);
    while (host.live.state !== 'ready') await Bun.sleep(1);
    client.onEvent({ method: 'Runtime.executionContextDestroyed', params: { executionContextId: 1 } });
    while (injections.length < 2) await Bun.sleep(1);
    expect(injections).toEqual([1, 2]);
    close(); await pending;
});

test('disconnect during Runtime.enable observes lifecycle rejection and releases listeners', async () => {
    let close!: () => void, unsubscribed = false;
    const client: any = { onEvent() {}, closed: new Promise<void>(resolve => { close = resolve; }), async call() {
        close(); await Promise.resolve(); throw new Error('closed during enable');
    } };
    const host: any = { live: {}, store: { subscribe: async () => () => { unsubscribed = true; } } };
    await expect(attach(client, '/* fixture */', host)).rejects.toThrow('closed during enable');
    expect(unsubscribed).toBe(true);
    await Bun.sleep(1);
});
