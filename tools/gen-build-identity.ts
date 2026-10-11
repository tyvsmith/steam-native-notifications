import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const root = resolve(import.meta.dir, '..');
const hash = createHash('sha256');
async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (!path.endsWith('build-identity.json')) { hash.update(relative(root, path)); hash.update(await readFile(path)); }
    }
}
for (const dir of ['frontend', 'shared', 'standalone', 'backend', 'tools']) await visit(resolve(root, dir));
hash.update(await readFile(resolve(root, 'package.json')));
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
await writeFile(resolve(root, 'shared/build-identity.json'), JSON.stringify({ protocolVersion: 1, version, buildId: hash.digest('hex') }) + '\n');
