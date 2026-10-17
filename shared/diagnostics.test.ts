import { expect, test } from 'bun:test';
import { createDiagnosticLogger } from './diagnostics';
import { preferencePatch, visibleSettings } from './settings-policy';
import { DEFAULTS, normalizeSettings, validateSettingsPatch } from './settings';

test('details require explicit opt-in and stop immediately when disabled', () => {
    const lines: string[] = [];
    let verbose = false;
    let evaluated = 0;
    const log = createDiagnosticLogger(line => { lines.push(line); }, () => verbose);
    const detail = () => { evaluated++; return 'private title, body, avatar, route, callback'; };
    log('toast captured', detail);
    expect(lines).toEqual(['toast captured']); expect(evaluated).toBe(0);
    verbose = true; log('toast captured', detail);
    verbose = false; log('toast captured', detail);
    expect(lines).toEqual(['toast captured', 'private title, body, avatar, route, callback', 'toast captured']);
    expect(evaluated).toBe(1);
});
test('logging never throws, including detail evaluation and rejected transport', async () => {
    const log = createDiagnosticLogger(() => Promise.reject(new Error('offline')), () => true);
    expect(() => log('health')).not.toThrow();
    expect(() => log('health', () => { throw new Error('bad detail'); })).not.toThrow();
    expect(() => createDiagnosticLogger(() => { throw new Error('offline'); }, () => false)('health')).not.toThrow();
    await Promise.resolve();
});
test('verbose diagnostics default off and accept only boolean settings', () => {
    expect(DEFAULTS.verboseDiagnostics).toBe(false);
    expect(normalizeSettings({ verboseDiagnostics: 'true' }).verboseDiagnostics).toBe(false);
    expect(validateSettingsPatch({ verboseDiagnostics: true })).toEqual({ verboseDiagnostics: true });
    expect(() => validateSettingsPatch({ verboseDiagnostics: 'true' })).toThrow();
});

test('CLI diagnostic opt-in does not require developer UI mode', () => {
    expect(preferencePatch({ verboseDiagnostics: true }, DEFAULTS, 'linux')).toEqual({ verboseDiagnostics: true });
    expect(visibleSettings({ ...DEFAULTS, devMode: true }, 'linux')).not.toContain('verboseDiagnostics');
});

test('formatter and diagnostic-setting failures retain the safe summary', () => {
    const lines: string[] = [];
    const write = (line: string) => { lines.push(line); };
    const broken = { get message(): string { throw new Error('unreadable detail'); } };
    const log = createDiagnosticLogger(write, () => true);
    log('delivery failed', () => broken.message);
    log('capture failed', () => { throw new Error('formatter failed'); });
    createDiagnosticLogger(write, () => { throw new Error('setting unavailable'); })('hook health', () => 'private');
    expect(lines).toEqual(['delivery failed', 'capture failed', 'hook health']);
});
