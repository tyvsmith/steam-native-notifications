import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupPaths, exists } from './paths';
import { setupIntegration, integrationCommand, recover } from './installer';

async function fixture() {
    const home = await mkdtemp(join(tmpdir(), 'snn integration spaces '));
    const p = setupPaths({}, home), steam = join(home, 'Steam root');
    await mkdir(join(steam, 'steamrt64'), { recursive: true });
    await writeFile(join(steam, 'steam.sh'), ''); await writeFile(join(steam, 'steamrt64/steam'), '');
    const cli = join(home, 'package cli.js'); await writeFile(cli, 'package-owned bytes');
    const runtime = { bun: process.execPath, cli, buildId: '1'.repeat(64) };
    return { home, p, steam, runtime };
}
const run = async (args: string[]) => args[0] === 'show' ? 'UnitFileState=enabled\nActiveState=active' : '';
const ready = async () => {};
test('Bun integration uses absolute runtime, preserves preferences and leaves package ownership alone', async () => {
    const f = await fixture(); try {
        await mkdir(join(f.p.config, '..'), { recursive: true });
        const preferences = ' {"unknown":42,"devFire":true}\n'; await writeFile(f.p.config, preferences);
        await writeFile(join(f.steam, '.cef-enable-remote-debugging'), 'shared marker');
        await setupIntegration(f.p, f.runtime, f.steam, run, ready);
        expect(await readFile(f.p.unit, 'utf8')).toContain(`"${process.execPath}" "${f.runtime.cli}"`);
        expect(await readFile(f.p.autostart, 'utf8')).toContain('"session"');
        await setupIntegration(f.p, f.runtime, undefined, run, ready);
        await integrationCommand('teardown', [], f.p, run);
        expect(await readFile(f.p.config, 'utf8')).toBe(preferences);
        expect(await readFile(join(f.steam, '.cef-enable-remote-debugging'), 'utf8')).toBe('shared marker');
        expect(await readFile(f.runtime.cli, 'utf8')).toBe('package-owned bytes');
        expect(await exists(f.p.unit)).toBe(false);
        expect(await integrationCommand('teardown', [], f.p, run)).toEqual({ removed: false });
    } finally { await rm(f.home, { recursive: true, force: true }); }
});
test('every enabled/active combination survives setup refresh', async () => {
    for (const enabled of [false, true]) for (const active of [false, true]) {
        const f = await fixture(); try {
            await setupIntegration(f.p, f.runtime, f.steam, run, ready);
            const calls: string[][] = []; let verified = false;
            await setupIntegration(f.p, f.runtime, undefined, async args => { calls.push(args); return args[0] === 'show' ? `UnitFileState=${enabled ? 'enabled' : 'disabled'}\nActiveState=${active ? 'active' : 'inactive'}` : ''; }, async () => { verified = true; });
            expect(verified).toBe(active);
            expect(calls.some(args => args[0] === 'restart')).toBe(active);
            expect(calls.some(args => ['enable', 'disable'].includes(args[0]!))).toBe(false);
        } finally { await rm(f.home, { recursive: true, force: true }); }
    }
});
test('failed readiness restores previous integration and service state without changing the package', async () => {
    const f = await fixture(); try {
        await setupIntegration(f.p, f.runtime, f.steam, run, ready);
        const original = await readFile(f.p.unit, 'utf8');
        const replacement = join(f.home, 'new cli.js'); await writeFile(replacement, 'new package');
        const calls: string[][] = [];
        await expect(setupIntegration(f.p, { ...f.runtime, cli: replacement }, undefined, async args => { calls.push(args); return args[0] === 'show' ? 'UnitFileState=disabled\nActiveState=active' : ''; }, async () => { throw Error('wrong daemon'); })).rejects.toThrow('wrong daemon');
        expect(await readFile(f.p.unit, 'utf8')).toBe(original);
        expect(calls.some(args => args[0] === 'disable')).toBe(true);
        expect(await recover(f.p, run)).toBe(false);
        expect(await readFile(replacement, 'utf8')).toBe('new package');
    } finally { await rm(f.home, { recursive: true, force: true }); }
});
test('foreign collisions, symlinks and modified managed files fail before service calls', async () => {
    const f = await fixture(); try {
        await mkdir(join(f.p.unit, '..'), { recursive: true });
        await symlink(f.runtime.cli, f.p.unit);
        let calls = 0; const counted = async () => { calls++; return ''; };
        await expect(setupIntegration(f.p, f.runtime, f.steam, counted, ready)).rejects.toThrow('collision');
        expect(calls).toBe(0); await rm(f.p.unit);
        await setupIntegration(f.p, f.runtime, f.steam, run, ready);
        await writeFile(f.p.unit, 'user changed');
        await expect(integrationCommand('teardown', [], f.p, counted)).rejects.toThrow('Modified/unowned');
        expect(calls).toBe(0);
        expect(await readFile(f.p.unit, 'utf8')).toBe('user changed');
    } finally { await rm(f.home, { recursive: true, force: true }); }
});
test('fresh activation failure disables service and removes managed integration', async () => {
    const f = await fixture(); try {
        const calls: string[][] = [];
        await expect(setupIntegration(f.p, f.runtime, f.steam, async args => { calls.push(args); return ''; }, async () => { throw Error('not ready'); })).rejects.toThrow('not ready');
        expect(calls.some(args => args[0] === 'disable' && args[1] === '--now')).toBe(true);
        expect(await exists(f.p.unit)).toBe(false);
        expect(await exists(f.p.state)).toBe(false);
        expect(await exists(f.p.config)).toBe(true);
        expect(await exists(join(f.steam, '.cef-enable-remote-debugging'))).toBe(true);
    } finally { await rm(f.home, { recursive: true, force: true }); }
});
for (const fresh of [true, false]) test(`setup recovery remains retryable at every boundary (${fresh ? 'fresh' : 'refresh'})`, async () => {
    for (let stop = 1; stop <= (fresh ? 5 : 5); stop++) {
        const f = await fixture(); try {
            if (!fresh) await setupIntegration(f.p, f.runtime, f.steam, run, ready);
            await expect(setupIntegration(f.p, f.runtime, f.steam, async args => { if (args[0] === 'restart' || args[0] === 'disable') throw Error('manager unavailable'); return args[0] === 'show' ? 'UnitFileState=enabled\nActiveState=active' : ''; }, ready)).rejects.toThrow('recovery pending');
            let steps = 0;
            await expect(recover(f.p, run, async () => { if (++steps === stop) throw Error('interrupted'); })).rejects.toThrow('interrupted');
            expect(await recover(f.p, run)).toBe(true);
            expect(await recover(f.p, run)).toBe(false);
            expect(await exists(f.p.state)).toBe(!fresh);
            await setupIntegration(f.p, f.runtime, f.steam, run, ready);
        } finally { await rm(f.home, { recursive: true, force: true }); }
    }
});
test('teardown resumes at every boundary and works after Steam removal', async () => {
    for (let stop = 1; stop <= 6; stop++) {
        const f = await fixture(); try {
            await setupIntegration(f.p, f.runtime, f.steam, run, ready);
            await rm(f.steam, { recursive: true });
            let steps = 0;
            await expect(integrationCommand('teardown', [], f.p, run, async () => { if (++steps === stop) throw Error('interrupted'); })).rejects.toThrow('interrupted');
            await integrationCommand('teardown', [], f.p, run);
            expect(await exists(f.p.state)).toBe(false);
            expect(await exists(f.runtime.cli)).toBe(true);
        } finally { await rm(f.home, { recursive: true, force: true }); }
    }
});
test('recovery refuses modified targets without deleting user changes', async () => {
    const f = await fixture(); try {
        await setupIntegration(f.p, f.runtime, f.steam, run, ready);
        await expect(integrationCommand('teardown', [], f.p, run, async () => { throw Error('interrupted'); })).rejects.toThrow('interrupted');
        await writeFile(f.p.autostart, 'user changed');
        let calls = 0;
        await expect(recover(f.p, async () => { calls++; return ''; })).rejects.toThrow('Modified recovery');
        expect(calls).toBe(0); expect(await readFile(f.p.autostart, 'utf8')).toBe('user changed');
    } finally { await rm(f.home, { recursive: true, force: true }); }
});
test('setup keeps the command lock until activation finishes', async () => {
    const f = await fixture();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const checkpointReached = new Promise<void>(resolve => { entered = resolve; });
    let setup: Promise<unknown> | undefined;
    try {
        setup = integrationCommand('setup', ['--steam-dir', f.steam], f.p, run, async step => {
            if (step === 'setup-journaled') { entered(); await held; }
        }, f.runtime, ready);
        await checkpointReached;
        await expect(integrationCommand('teardown', [], f.p, run)).rejects.toThrow('Setup locked');
        expect(await exists(`${f.p.state}.lock`)).toBe(true);
        release(); await setup;
        expect(await exists(`${f.p.state}.lock`)).toBe(false);
        await integrationCommand('teardown', [], f.p, run);
    } finally { release(); await setup?.catch(() => {}); await rm(f.home, { recursive: true, force: true }); }
});
test('teardown preserves files edited while the service is stopping', async () => {
    const f = await fixture(); try {
        await setupIntegration(f.p, f.runtime, f.steam, run, ready);
        await expect(integrationCommand('teardown', [], f.p, async args => {
            if (args[0] === 'disable') await writeFile(f.p.unit, 'edited during stop');
            return run(args);
        })).rejects.toThrow('Modified recovery target');
        expect(await readFile(f.p.unit, 'utf8')).toBe('edited during stop');
        expect(await exists(f.p.autostart)).toBe(true);
    } finally { await rm(f.home, { recursive: true, force: true }); }
});
