import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { healthExpression, heartbeatReady } from './health';
function fixture(response = 'ok') {
    const forwarded: unknown[][] = [];
    const original = (...args: unknown[]) => forwarded.push(args);
    const context: any = { setTimeout, clearTimeout, __snnStandaloneStarted: true, __snnConfig() {}, __snnReply: original };
    context.__snnHost = (payload: string) => {
        const request = JSON.parse(payload);
        context.__snnReply(12, 'ordinary-reply');
        context.__snnReply(request.id, response, null);
    };
    return { context, forwarded, original };
}
test('baseline browser RPC health roundtrip forwards pending replies and restores dispatcher', async () => {
    const { context, forwarded, original } = fixture();
    expect(await runInNewContext(healthExpression(2 ** 52), context)).toBe(true);
    expect(forwarded).toEqual([[12, 'ordinary-reply']]); expect(context.__snnReply).toBe(original);
});
test('health refuses incomplete bridge, bad response and dead backend; timeout restores dispatcher', async () => {
    const { context, original } = fixture('unsupported');
    expect(await runInNewContext(healthExpression(2 ** 52), context)).toBe(false);
    context.__snnHost = () => {};
    expect(await runInNewContext(healthExpression(2 ** 52), context)).toBe(false);
    expect(context.__snnReply).toBe(original);
    context.__snnStandaloneStarted = false;
    expect(await runInNewContext(healthExpression(2 ** 52), context)).toBe(false);
});

test('readiness requires recent responsive heartbeat, matching Steam root and live daemon; stale/future logs cannot pass', () => {
    const heartbeat = { state: 'ready', steam: '/Steam', pid: 123, at: 10000 };
    expect(heartbeatReady(heartbeat, '/Steam', 12000, () => true)).toBe(true);
    for (const bad of [{ at: 0 }, { at: 13000 }, { at: '10000' }, { state: 'disconnected' }, { steam: '/other' }, { pid: -1 }, { pid: NaN }]) {
        expect(heartbeatReady({ ...heartbeat, ...bad }, '/Steam', 12000, () => true)).toBe(false);
    }
    expect(heartbeatReady(heartbeat, '/Steam', 12000, () => false)).toBe(false);
    expect(heartbeatReady(undefined, '/Steam', 12000, () => true)).toBe(false);
});
