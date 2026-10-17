import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSETS, sha256, validateRelease, type Manifest } from './package-manifest';

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'snn manifest '));
    const m: Manifest = { format: 3, version: '0.1.0', buildId: 'a'.repeat(64), target: 'linux-x64', bun: '>=1.4.3', files: {} };
    const pkg = { name: '@tyvsmith/steam-native-notifications', version: m.version, type: 'module', bin: { snn: 'standalone/cli.js' }, engines: { bun: m.bun }, os: ['linux'], cpu: ['x64'], files: [...ASSETS.filter(p => p !== 'package.json'), 'manifest.json'].sort(), scripts: { postinstall: 'bun standalone/cli.js setup --hook' } };
    async function put(path: string, text: string) { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), text, { mode: ['standalone/cli.js', 'tools/notify-action'].includes(path) ? 0o755 : 0o644 }); m.files[path] = sha256(text); }
    for (const p of ASSETS) await put(p, p === 'package.json' ? JSON.stringify(pkg) : p === 'dist/standalone/build.json' ? JSON.stringify({ protocolVersion: 1, buildId: m.buildId, version: m.version }) : p);
    const save = () => writeFile(join(root, 'manifest.json'), JSON.stringify(m));
    await save();
    return { root, m, pkg, put, save };
}

test('package validation rejects corruption, hidden assets and lifecycle expansion', async () => {
    const f = await fixture();
    try {
        expect((await validateRelease(f.root)).format).toBe(3);
        await writeFile(join(f.root, 'standalone/cli.js'), 'modified');
        await expect(validateRelease(f.root)).rejects.toThrow('checksum mismatch');
        await f.put('standalone/cli.js', 'restored'); await f.save();
        await symlink('/tmp', join(f.root, 'unexpected'));
        await expect(validateRelease(f.root)).rejects.toThrow('symlink refused');
        await rm(join(f.root, 'unexpected'));
        await f.put('package.json', JSON.stringify({ ...f.pkg, scripts: { ...f.pkg.scripts, preuninstall: 'bun cleanup.js' } })); await f.save();
        await expect(validateRelease(f.root)).rejects.toThrow('Unexpected package scripts');
    } finally { await rm(f.root, { recursive: true, force: true }); }
});
