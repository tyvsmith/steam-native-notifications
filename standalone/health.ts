/** A transient probe works with the baseline browser bundle. It roundtrips a
 * reserved RPC ID through the current binding/backend, forwarding every normal
 * reply unchanged and restoring the dispatcher on completion or timeout. */
export function healthExpression(id: number): string {
    return `new Promise(resolve => {
        if (!globalThis.__snnStandaloneStarted || typeof globalThis.__snnHost !== 'function' || typeof globalThis.__snnReply !== 'function' || typeof globalThis.__snnConfig !== 'function') { resolve(false); return; }
        const original = globalThis.__snnReply;
        let finished = false;
        const finish = value => {
            if (finished) return;
            finished = true; clearTimeout(timer);
            if (globalThis.__snnReply === reply) globalThis.__snnReply = original;
            resolve(value);
        };
        const reply = (...args) => args[0] === ${id} ? finish(args[1] === 'ok' && !args[2]) : original(...args);
        const timer = setTimeout(() => finish(false), 1500);
        globalThis.__snnReply = reply;
        try { globalThis.__snnHost(JSON.stringify({id:${id}, method:'Health', args:[]})); }
        catch { finish(false); }
    })`;
}
