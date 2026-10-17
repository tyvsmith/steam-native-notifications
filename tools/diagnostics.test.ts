import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';

test('live settings gate real replay exception and callback diagnostics', async () => {
    const entry = resolve(import.meta.dir, '../frontend/log.ts');
    const build = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'cjs', plugins: [{
        name: 'diagnostic-fixture', setup(builder) {
            builder.onLoad({ filter: /frontend\/log\.ts$/ }, async args => ({ loader: 'ts', contents:
                readFileSync(args.path, 'utf8') + '\nexport { loadSettings } from "./settings"; export { stashToastHandler, invokeReplayHandler } from "./replay";' }));
            builder.onResolve({ filter: /^millennium$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents:
                'export const ffi = name => (...args) => globalThis.rpc(name, args); export const pluginConfig = { getAll: async () => ({}) }; export const subscribePluginConfig = fn => { globalThis.changed = fn; }; export const findModuleExport = () => undefined;' }));
        },
    }] });
    expect(build.success).toBe(true);
    const lines: string[] = [];
    const context: any = { module: { exports: {} }, setTimeout, rpc: (name: string, args: string[]) => { if (name === 'Log') lines.push(args[0]); return 'ok'; } };
    runInNewContext(await build.outputs[0].text(), context);
    const api = context.module.exports;
    await api.loadSettings();
    const secret = 'private-message-steamid-76561198000000000';
    const document: any = {};
    const fn = () => { throw new Error(secret); };
    const fiber = { tag: 4, stateNode: { containerInfo: { ownerDocument: document } }, memoizedProps: { onClick: fn } };
    document.querySelectorAll = () => [{ __reactFiber$test: fiber }];
    const win: any = { document };
    const token = '1'.repeat(32);
    api.stashToastHandler(win, 'notificationtoasts_1_desktop', token);
    await api.invokeReplayHandler(token, 0);
    expect(lines.join('\n')).toContain('THREW');
    expect(lines.join('\n')).not.toContain(secret);
    context.changed('verboseDiagnostics', true);
    await api.invokeReplayHandler(token, 0);
    expect(lines.join('\n')).toContain(secret);
    lines.length = 0;
    context.changed('verboseDiagnostics', false);
    await api.invokeReplayHandler(token, 0);
    expect(lines.join('\n')).not.toContain(secret);
});
