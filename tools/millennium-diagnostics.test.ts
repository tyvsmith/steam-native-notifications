import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { BUILD_IDENTITY } from '../shared/host';
test('pushed requests are fenced by expiry and frontend lifetime without idle timers', async () => {
    const built = await Bun.build({ entrypoints: [resolve('frontend/millennium-diagnostics.ts')], target: 'browser', format: 'cjs', plugins: [{ name: 'fixture', setup(build) {
        build.onResolve({ filter: /^millennium$/ }, () => ({ path: 'ffi', namespace: 'fixture' }));
        build.onResolve({ filter: /^\.\/settings$/ }, args => args.importer.endsWith('/frontend/millennium-diagnostics.ts') ? ({ path: 'settings', namespace: 'fixture' }) : undefined);
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'settings' ? 'export const settingsHost = { read: () => globalThis.reload() };' : 'export const ffi = name => (...args) => globalThis.call(name, args);', loader: 'js' }));
    } }] });
    expect(built.success).toBe(true);
    const replies: any[] = []; let reads = 0; let release: (() => void) | undefined;
    const context: any = { module: { exports: {} }, Date, __snnHookState: 'installed', __snnDevControl: async () => ({ ok: true }),
        reload: () => { reads++; return new Promise<void>(resolve => { release = resolve; }); },
        call: async (_name: string, args: string[]) => { replies.push(JSON.parse(args[1]!)); } };
    runInNewContext(await built.outputs[0]!.text(), context);
    const api = context.module.exports; const stop = api.startMillenniumDiagnostics();
    const send = (r: any) => api.receiveControl(JSON.stringify({ kind: 'status', ...r, deadline: String(r.deadline ?? Date.now() + 1000) }));
    send({ id: 'expired', deadline: Date.now() - 1 });
    expect(replies).toHaveLength(0);
    expect(send({ id: 'fresh' })).toBeUndefined();
    expect(replies[0]).toMatchObject({ id: 'fresh', frontendBuild: BUILD_IDENTITY, hook: 'installed', control: true });
    expect(reads).toBe(0);
    send({ id: 'refresh', command: 'refresh-settings' });
    expect(reads).toBe(1); release!(); await Bun.sleep(0);
    expect(replies[1]).toMatchObject({ id: 'refresh', settingsRefreshed: true });
    context.reload = async () => { throw Error('offline'); };
    send({ id: 'failed-refresh', command: 'refresh-settings' }); await Bun.sleep(0);
    expect(replies[2]).toMatchObject({ id: 'failed-refresh', settingsRefreshed: false });
    context.reload = () => new Promise<void>(resolve => { release = resolve; });
    send({ id: 'expired-refresh', command: 'refresh-settings', deadline: Date.now() + 5 });
    await Bun.sleep(10); release!(); await Bun.sleep(0); expect(replies).toHaveLength(3);
    send({ id: 'stopped-refresh', command: 'refresh-settings' });
    stop(); release!(); await Bun.sleep(0); expect(replies).toHaveLength(3);
    send({ id: 'stopped' }); expect(replies).toHaveLength(3);
    const stopNext = api.startMillenniumDiagnostics();
    send({ id: 'next' }); expect(replies[3]?.id).toBe('next'); stopNext();
});

test('host adapters keep plugin-scoped SDK references as direct calls for Starlight', async () => {
    const ts = await import('typescript');
    // Starlight injects pluginName into SDK calls, not function references.
    for (const [file, name] of [['frontend/host.ts', 'ffi'], ['frontend/settings.ts', 'subscribePluginConfig']] as const) {
        const source = ts.createSourceFile(file, await Bun.file(file).text(), ts.ScriptTarget.Latest, true);
        const indirect: number[] = [];
        function visit(node: import('typescript').Node) {
            if (ts.isImportDeclaration(node)) return;
            if (ts.isIdentifier(node) && node.text === name &&
                !(ts.isCallExpression(node.parent) && node.parent.expression === node)) indirect.push(node.getStart(source));
            ts.forEachChild(node, visit);
        }
        visit(source);
        expect({ file, indirect }).toEqual({ file, indirect: [] });
    }
});

test('a concurrent config event cannot discard untouched saved preferences on startup', async () => {
    const built = await Bun.build({ entrypoints: [resolve('frontend/settings.ts')], target: 'browser', format: 'cjs', plugins: [{ name: 'config-fixture', setup(build) {
        build.onResolve({ filter: /^millennium$/ }, () => ({ path: 'config', namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const pluginConfig = globalThis.config; export const subscribePluginConfig = globalThis.listen;', loader: 'js' }));
    } }] });
    expect(built.success).toBe(true);
    let listener!: (key: string, value: boolean) => void;
    let release!: (value: unknown) => void;
    let first = true;
    const saved = { integrationEnabled: false, notifyOutsideGame: false, devFire: false };
    const initial = { ...saved };
    const context: any = { module: { exports: {} }, setTimeout,
        config: { getAll: () => { if (first) { first = false; return new Promise(resolve => { release = resolve; }); } return Promise.resolve({ ...saved }); } },
        listen: (cb: typeof listener) => { listener = cb; return () => {}; },
    };
    runInNewContext(await built.outputs[0]!.text(), context);
    const loading = context.module.exports.loadSettings();
    saved.devFire = true; listener('devFire', true); release(initial);
    await loading;
    expect(context.module.exports.settings()).toMatchObject(saved);
});
