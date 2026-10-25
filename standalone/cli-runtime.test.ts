import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';

async function fixture() {
    const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, 'cli.ts')], target: 'browser', format: 'cjs', plugins: [{ name: 'commands', setup(build) {
        build.onLoad({ filter: /[\\/]cli\.ts$/, namespace: 'file' }, async args => ({ loader: 'ts', contents: (await Bun.file(args.path).text()).split('if (import.meta.main)')[0] }));
        build.onResolve({ filter: /.*/ }, args => args.path === resolve(import.meta.dir, 'cli.ts') ? undefined : ({ path: args.path, namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
            export const assertSupportedBun = () => { globalThis.checked++; throw Error('Update Bun'); };
            export const setupHookAllowed = async () => false;
            export const integrationCommand = async () => { globalThis.launched++; };
            export const daemonMain = integrationCommand, configCommand = integrationCommand, developerCommand = integrationCommand;
            export const capture = integrationCommand, sample = integrationCommand, hostStatus = integrationCommand;
            export const parseCommonOptions = args => ({ args, host: 'auto', json: false });
            export const printResult = () => {}, printError = () => {}, dependencies = () => ({}), BUILD_IDENTITY = {};
        ` }));
    } }] });
    if (!built.success) throw Error(built.logs.join('\n'));
    const context: any = { module: { exports: {} }, checked: 0, launched: 0, console: { error() {} } };
    runInNewContext(await built.outputs[0]!.text(), context);
    return { context, main: context.module.exports.main };
}
test('skipped package hooks do not require a supported runtime or change integration', async () => {
    const f = await fixture();
    await f.main(['setup', '--hook']); await f.main(['teardown', '--hook']);
    expect(f.context.checked).toBe(0); expect(f.context.launched).toBe(0);
});
test('explicit integration and client commands reject unsupported Windows runtimes', async () => {
    const f = await fixture();
    for (const command of ['setup', 'teardown', 'recover', 'daemon', 'sample', 'status', 'config']) {
        await expect(f.main([command])).rejects.toThrow('Update Bun');
    }
    expect(f.context.launched).toBe(0);
});
