import { describe, expect, test } from 'bun:test';
import { authenticateControl, authenticatedControl } from './control';
import { taskSource } from './windows-installer';
import { psQuote, exclusiveFile } from './windows';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Windows control authentication', () => {
    test('authenticates request without disclosing the secret', () => {
        const request = { id: 'a', deadline: 123, operation: 'config.update', payload: { devMode: true } };
        const signed = { ...request, token: authenticateControl(request, 'secret') };
        expect(JSON.stringify(signed)).not.toContain('secret');
        expect(authenticatedControl(signed, 'secret')).toBe(true);
        expect(authenticatedControl(signed, 'other-user')).toBe(false);
        expect(authenticatedControl({ ...signed, payload: { devMode: false } }, 'secret')).toBe(false);
        expect(authenticatedControl({ ...signed, deadline: 456 }, 'secret')).toBe(false);
        expect(authenticatedControl({ ...signed, token: 'é'.repeat(64) }, 'secret')).toBe(false);
    });
    test('authenticates replies including error content', () => {
        const reply = { id: 'b', ok: false, error: 'failed' };
        const signed = { ...reply, token: authenticateControl(reply, 'secret') };
        expect(authenticatedControl(signed, 'secret')).toBe(true);
        expect(authenticatedControl({ ...signed, ok: true }, 'secret')).toBe(false);
    });
});
test('scheduled task uses interactive limited account and hidden launch', () => {
    const source = taskSource('C:\\Users\\Test User\\bun.exe', 'C:\\package\\cli.js', 'C:\\Steam', 'C:\\config.json');
    expect(source).toContain('-LogonType Interactive -RunLevel Limited');
    expect(source).toContain('-AtLogOn -User $user');
    expect(source).toContain('IgnoreNew');
    expect(source).not.toContain('-Password');
    expect(() => taskSource('bad"path', 'cli', 'steam', 'config')).toThrow();
    expect(psQuote("a'b")).toBe("'a''b'");
});
test.skipIf(process.platform !== 'win32')('exclusive handle excludes another writer and releases', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snn-win-lock-'));
    try { const file = join(dir, 'lock'); const close = await exclusiveFile(file, 0); await expect(exclusiveFile(file, 0)).rejects.toThrow(); close(); (await exclusiveFile(file, 0))(); }
    finally { await rm(dir, { recursive: true, force: true }); }
});
test.skipIf(process.platform !== 'win32')('private named pipe serves authenticated control and closes cleanly', async () => {
    const { startControl, controlCall } = await import('./control');
    const dir = await mkdtemp(join(tmpdir(), 'snn-win-control-'));
    const original = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = dir;
    let close: (() => Promise<void>) | undefined;
    try {
        close = await startControl(async request => ({ operation: request.operation }));
        expect(await controlCall('status')).toEqual({ operation: 'status' });
        await close(); close = undefined;
        await expect(controlCall('status', undefined, { timeoutMs: 100 })).rejects.toThrow();
    } finally { await close?.(); process.env.LOCALAPPDATA = original; await rm(dir, { recursive: true, force: true }); }
});
