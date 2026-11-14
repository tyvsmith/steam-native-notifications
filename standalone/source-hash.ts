import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';

// The source and build recipe, not compiled bytes; the executing Bun stands in for the compiler.
const buildFiles = ['package.json', 'bun.lock', 'millennium.toml', 'tsconfig.json'];
const sourceDirectories = ['frontend', 'shared', 'standalone', 'backend', 'tools'];
const excludedDirectories = new Set(['__pycache__', '.cache', 'node_modules', 'dist', 'build']);
// Extensionless entries are the shell helpers.
const sourceExtensions = new Set(['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.lua', '.ps1', '.sh', '.py', '.example']);

export async function sourceBuildId(root = resolve(import.meta.dir, '..'), bunVersion = Bun.version): Promise<string> {
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
            } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
                await addFile(path);
            }
        }
    }
    for (const dir of sourceDirectories) await visit(resolve(root, dir));
    for (const file of buildFiles) await addFile(resolve(root, file));
    return hash.digest('hex');
}
