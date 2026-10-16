import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { BUILD_IDENTITY } from '../shared/host';
test('actual frontend answers only live challenges and reports failures without throwing', async () => {
    const built = await Bun.build({ entrypoints: [resolve('frontend/millennium-diagnostics.ts')], target: 'browser', format: 'cjs', plugins: [{ name: 'ffi-fixture', setup(build) {
        build.onResolve({ filter: /^millennium$/ }, () => ({ path: 'ffi', namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const ffi = name => (...args) => globalThis.call(name, args);', loader: 'js' }));
    } }] });
    expect(built.success).toBe(true);
    let tick!: () => Promise<void>; let request: any; let fail = false;
    const replies: any[] = [];
    const context: any = { module: { exports: {} }, Date, setInterval: (fn: any) => { tick = fn; return 1; }, clearInterval() {}, __snnHookState: 'installed', __snnDevControl() {},
        call: async (name: string, args: string[]) => { if (fail) throw Error('offline'); if (name === 'TakeDiagnosticCommand') { const next = request; request = null; return JSON.stringify(next); } replies.push([args[0], JSON.parse(args[1]!)]); return 'ok'; } };
    runInNewContext(await built.outputs[0]!.text(), context);
    const api = context.module.exports; const stop = api.startMillenniumDiagnostics();
    request = { id: 'expired', deadline: Date.now() - 1 }; await tick(); expect(replies).toHaveLength(0);
    request = { id: 'fresh', deadline: Date.now() + 1000 }; await tick();
    expect(replies[0]).toEqual(['status', { id: 'fresh', frontendBuild: BUILD_IDENTITY, hook: 'installed', control: true }]);
    await api.reportCommandResult('command', { ok: false, error: 'refused' });
    expect(replies[1][1]).toEqual({ id: 'command', result: { ok: false, error: 'refused' } });
    fail = true; await tick(); await api.reportCommandResult('ignored', {});
    fail = false; stop(); await tick(); expect(replies).toHaveLength(2);
});
