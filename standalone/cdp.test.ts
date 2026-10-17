import { expect, test } from 'bun:test';
import { CDP, endpoint, targetSocket } from './cdp';
import { attach, connectSteamContext } from './daemon';
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
    expect(logs.length).toBe(2);
    expect(calls.some(call => call.params?.expression?.includes('__snnReply?.(2,"linux"'))).toBe(true);
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

test('context replacement while reading command settings refuses stale dispatch', async () => {
    let running = true, reads = 0, commands = 0;
    const client: any = { onEvent() {}, closed: new Promise(() => {}), async call(method: string, params: any) {
        if (method === 'Runtime.enable') this.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 1, auxData: { isDefault: true } } } });
        if (params?.expression?.includes('globalThis.__snnDevControl ?')) commands++;
        return { result: { value: true } };
    } };
    const host: any = { live: {}, log: async () => {}, async settings() {
        if (++reads === 2) client.onEvent({ method: 'Runtime.executionContextsCleared' });
        return {};
    }, async readiness() {
        const command = host.frontendCommand;
        await expect(command({ deadline: Date.now() + 2000 }, true)).rejects.toThrow('Frontend changed');
        running = false;
    } };
    await attach(client, '/* fixture */', host, () => running);
    expect(commands).toBe(0);
});

test('a delayed config poll cannot overwrite the fresh command snapshot', async () => {
    let running = true, reads = 0, readiness = 0, release!: () => void, started!: () => void;
    const polling = new Promise<void>(resolve => { started = resolve; });
    const writes: boolean[] = [];
    const client: any = { onEvent() {}, closed: new Promise(() => {}), async call(method: string, params: any) {
        if (method === 'Runtime.enable') this.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 1, auxData: { isDefault: true } } } });
        const match = params?.expression?.match(/globalThis\.__snnConfig\((\{"integrationEnabled":(?:true|false)\})\)/);
        if (match) writes.push(JSON.parse(match[1]).integrationEnabled);
        if (params?.expression?.includes('globalThis.__snnDevControl ?')) return { result: { value: { ok: true, value: { stage: 'executed' } } } };
        return { result: { value: true } };
    } };
    const host: any = { live: {}, log: async () => {}, async settings() {
        const read = ++reads;
        if (read === 2) { started(); await new Promise<void>(resolve => { release = resolve; }); }
        return { integrationEnabled: read >= 3 };
    }, async readiness() { if (++readiness === 2) running = false; } };
    const attached = attach(client, '/* fixture */', host, () => running);
    try {
        await polling;
        await host.frontendCommand({ deadline: Date.now() + 2000 }, true);
        release(); await attached;
        expect(writes).toEqual([false, true]);
    } finally { running = false; release?.(); await attached; }
});
