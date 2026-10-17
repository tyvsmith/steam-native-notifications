import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { sourceBuildIdentity } from './gen-build-identity';

export async function verifyReleaseSource(root: string, manifest: unknown, identity: unknown): Promise<void> {
    const expected = await sourceBuildIdentity(root);
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
