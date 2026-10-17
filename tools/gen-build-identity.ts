import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';

// Fingerprints the shared source and build recipe, not compiled artifact bytes.
// Dependency/compiler versions come from the lockfile and the executing Bun.
const buildFiles = ['package.json', 'bun.lock', 'millennium.toml', 'tsconfig.json'];
const sourceDirectories = ['frontend', 'shared', 'standalone', 'backend', 'tools'];
const excludedDirectories = new Set(['__pycache__', '.cache', 'node_modules', 'dist', 'build']);
// Includes extensionless shell helpers and generated notification source. Derived
// bytecode, maps and native binaries are not build identity inputs.
const sourceExtensions = new Set(['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.lua', '.ps1', '.sh', '.py', '.example']);
export async function sourceBuildIdentity(root: string, bunVersion = Bun.version) {
    const hash = createHash('sha256');
    hash.update(`bun:${bunVersion}\0`);
    async function addFile(path: string) {
        const bytes = await readFile(path);
        hash.update(`${relative(root, path).replaceAll('\\', '/')}\0${bytes.length}\0`);
        hash.update(bytes);
    }
    async function visit(directory: string): Promise<void> {
        for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                if (!excludedDirectories.has(entry.name)) await visit(path);
            } else if (entry.isFile() && entry.name !== 'build-identity.json' && sourceExtensions.has(extname(entry.name))) {
                await addFile(path);
            }
        }
    }
    for (const dir of sourceDirectories) await visit(resolve(root, dir));
    for (const file of buildFiles) await addFile(resolve(root, file));
    const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    return { protocolVersion: 1, version, buildId: hash.digest('hex') };
}
if (import.meta.main) {
    const root = resolve(import.meta.dir, '..');
    await writeFile(resolve(root, 'shared/build-identity.json'), JSON.stringify(await sourceBuildIdentity(root)) + '\n');
}
