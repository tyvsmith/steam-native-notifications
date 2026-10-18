import { expect, test } from 'bun:test';
import { planFire } from './lib/devtools';
import { validateDevCommand } from '../shared/dev-command';
import { windowsGameFocus } from '../standalone/game-focus';
test('host focus grammar and shared validation', () => {
    expect(planFire(['--host-focus', '17'])).toMatchObject({ kind: 'queue', command: { focus: { appid: 17 } } });
    for (const args of [[], ['0'], ['-1'], ['1.5'], ['4294967296'], ['17', 'extra']]) expect(planFire(['--host-focus', ...args]).kind).toBe('error');
    expect(validateDevCommand({ focus: { appid: 17 } })).toEqual({ focus: { appid: 17 } });
    for (const focus of [{ appid: 0 }, { appid: 17, extra: true }, { appid: '17' }]) expect(() => validateDevCommand({ focus })).toThrow();
});
test('standalone adapter rejects invalid appids before process creation', async () => {
    for (const appid of [0, -1, 1.5, 0x100000000]) expect(await windowsGameFocus('', '', appid)).toBe('unknown');
});

test('standalone adapter accepts only successful bounded verdicts', async () => {
    if (process.platform === 'win32') return; // Native PowerShell policy fixtures run in Windows CI.
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const directory = await mkdtemp('/tmp/snn-focus-adapter-');
    const previous = process.env.PATH;
    process.env.PATH = directory + ':' + previous;
    try {
        for (const [body, expected] of [
            ['printf game', 'game'], ['exec sleep 10', 'unknown'], ['printf desktop', 'desktop'],
            ['printf desktop; exit 1', 'unknown'], ['printf garbage', 'unknown'],
            ['printf desktop; printf "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"', 'unknown'],
        ]) {
            await writeFile(directory + '/powershell.exe', '#!/bin/sh\n' + body + '\n', { mode: 0o700 });
            const started = Date.now();
            expect(await windowsGameFocus('helper.ps1', 'Steam', 17)).toBe(expected);
            if (body === 'exec sleep 10') { expect(Date.now() - started).toBeGreaterThanOrEqual(1800); expect(Date.now() - started).toBeLessThan(2800); }
        }
    } finally { process.env.PATH = previous; await rm(directory, { recursive: true, force: true }); }
});
