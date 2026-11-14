import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PROTOCOL_VERSION } from '../shared/host';
import { sourceBuildId } from '../standalone/source-hash';

export async function verifyReleaseSource(root: string, manifest: unknown, identity: unknown): Promise<void> {
    const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    const expected = { protocolVersion: PROTOCOL_VERSION, version, buildId: await sourceBuildId(root) };
    const matches = (value: unknown): boolean => typeof value === 'object' && value !== null &&
        'version' in value && value.version === expected.version &&
        'buildId' in value && value.buildId === expected.buildId;
    if (!matches(manifest) || !matches(identity) ||
        !('protocolVersion' in (identity as object)) || (identity as { protocolVersion: unknown }).protocolVersion !== expected.protocolVersion) {
        throw new Error('Release asset identity differs from checked-out source');
    }
}

if (import.meta.main) {
    const archive = process.argv[2];
    if (!archive) throw new Error('Expected release tarball path');
    const readMember = (member: string): unknown => JSON.parse(execFileSync('tar', ['-xOf', resolve(archive), `package/${member}`], { encoding: 'utf8' }));
    await verifyReleaseSource(process.cwd(), readMember('manifest.json'), readMember('dist/standalone/build.json'));
}
