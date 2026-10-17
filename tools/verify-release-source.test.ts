import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sourceBuildIdentity } from './gen-build-identity';
import { verifyReleaseSource } from './verify-release-source';

test('publication recomputes source identity and rejects stale same-version assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snn-publish-source-'));
    try {
        for (const directory of ['frontend', 'shared', 'standalone', 'backend', 'tools']) await mkdir(join(root, directory));
        await writeFile(join(root, 'package.json'), '{"version":"0.1.0"}');
        for (const file of ['bun.lock', 'millennium.toml', 'tsconfig.json']) await writeFile(join(root, file), 'original');
        const identity = await sourceBuildIdentity(root);
        const manifest = { version: identity.version, buildId: identity.buildId };
        await writeFile(join(root, 'shared/build-identity.json'), JSON.stringify(identity));
        await verifyReleaseSource(root, manifest, identity);
        await expect(verifyReleaseSource(root, manifest, { ...identity, buildId: 'wrong' })).rejects.toThrow('source');
        await expect(verifyReleaseSource(root, { ...manifest, buildId: 'wrong' }, identity)).rejects.toThrow('source');
        // The generated identity remains unchanged while a dependency input changes.
        await writeFile(join(root, 'bun.lock'), 'changed dependency');
        await expect(verifyReleaseSource(root, manifest, identity)).rejects.toThrow('source');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
