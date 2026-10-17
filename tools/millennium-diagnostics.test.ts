import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { BUILD_IDENTITY } from '../shared/host';
test('actual frontend answers only live challenges and reports failures without throwing', async () => {
    const built = await Bun.build({ entrypoints: [resolve('frontend/millennium-diagnostics.ts')], target: 'browser', format: 'cjs', plugins: [{ name: 'ffi-fixture', setup(build) {
        build.onResolve({ filter: /^millennium$/ }, () => ({ path: 'ffi', namespace: 'fixture' }));
        build.onResolve({ filter: /^\.\/settings$/ }, args => args.importer.endsWith('/frontend/millennium-diagnostics.ts') ? ({ path: 'settings', namespace: 'fixture' }) : undefined);
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'settings' ? 'export const settingsHost = { read: () => globalThis.reload() };' : 'export const ffi = name => (...args) => globalThis.call(name, args);', loader: 'js' }));
    } }] });
    expect(built.success).toBe(true);
    let tick!: () => Promise<void>; let request: any; let fail = false;
    const replies: any[] = []; let reads = 0; let reloadFailure = false;
    const context: any = { module: { exports: {} }, Date, setInterval: (fn: any) => { tick = fn; return 1; }, clearInterval() {}, __snnHookState: 'installed', __snnDevControl() {},
        reload: async () => { reads++; if (reloadFailure) throw Error('offline'); },
        call: async (name: string, args: string[]) => { if (fail) throw Error('offline'); if (name === 'TakeDiagnosticCommand') { const next = request; request = null; return JSON.stringify(next); } replies.push([args[0], JSON.parse(args[1]!)]); return 'ok'; } };
    runInNewContext(await built.outputs[0]!.text(), context);
    const api = context.module.exports; const stop = api.startMillenniumDiagnostics();
    request = { id: 'expired', deadline: Date.now() - 1 }; await tick(); expect(replies).toHaveLength(0);
    request = { id: 'fresh', deadline: Date.now() + 1000 }; await tick();
    expect(replies[0]).toEqual(['status', { id: 'fresh', frontendBuild: BUILD_IDENTITY, hook: 'installed', control: true }]);
    await api.reportCommandResult('command', { ok: false, error: 'refused' });
    expect(replies[1][1]).toEqual({ id: 'command', result: { ok: false, error: 'refused' } });
    await tick(); expect(reads).toBe(0); // Empty/status polls do not read config.
    request = { id: 'refresh', command: 'refresh-settings', deadline: Date.now() + 1000 }; await tick();
    expect(reads).toBe(1); expect(replies[2][1]).toMatchObject({ id: 'refresh', settingsRefreshed: true });
    reloadFailure = true;
    request = { id: 'failed-refresh', command: 'refresh-settings', deadline: Date.now() + 1000 }; await tick();
    expect(replies[3][1]).toMatchObject({ id: 'failed-refresh', settingsRefreshed: false });
    request = { id: 'expired-refresh', command: 'refresh-settings', deadline: Date.now() - 1 }; await tick();
    expect(reads).toBe(2);
    fail = true; await tick(); await api.reportCommandResult('ignored', {});
    fail = false; stop(); await tick(); expect(replies).toHaveLength(4);
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
