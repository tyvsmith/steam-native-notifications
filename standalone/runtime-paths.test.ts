import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRuntimeRoot } from './runtime-paths';

test('source checkout root does not depend on the Bun executable name or platform', () => {
    expect(resolveRuntimeRoot('/checkout/standalone', '/opt/bun')).toBe('/checkout');
    expect(resolveRuntimeRoot('/checkout/standalone', '/opt/renamed-runtime')).toBe('/checkout');
    expect(resolveRuntimeRoot('C:\\checkout\\standalone', 'C:\\Bun\\bun.exe')).toBe('C:\\checkout');
});

test('compiled module assets follow the physical executable behind the stable link', () => {
    const root = mkdtempSync(join(tmpdir(), 'snn runtime '));
    try {
        const version = join(root, 'version');
        mkdirSync(version);
        symlinkSync(join(version, 'snn'), join(root, 'snn'));
        writeFileSync(join(version, 'snn'), '');
        expect(resolveRuntimeRoot('/$bunfs/root', join(root, 'snn'))).toBe(version);
        expect(resolveRuntimeRoot('/$bunfs/root', join(version, 'snn'))).toBe(version);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
