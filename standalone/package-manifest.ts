import { readdir, lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export const ASSETS = ['standalone/cli.js', 'package.json', 'LICENSE', 'dist/standalone/frontend.js', 'dist/standalone/build.json', 'tools/notify-action', 'tools/notify-action.ps1', 'standalone/focus.lua', 'backend/game_focus.lua', 'backend/focus/wayland.lua', 'backend/focus/gamescope.lua', 'docs/standalone-release.md', 'docs/standalone-notices.md', 'docs/windows-standalone.md'].sort();
export const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
export type Manifest = { format: 3; version: string; buildId: string; target: 'linux-windows-x64'; bun: string; files: Record<string,string> };
export async function inventory(root: string, prefix = ''): Promise<string[]> {
    const out: string[] = [];
    for (const name of await readdir(join(root,prefix))) {
        const rel = prefix ? `${prefix}/${name}` : name; const stat = await lstat(join(root,rel));
        if (stat.isSymbolicLink()) throw new Error(`Release symlink refused: ${rel}`);
        if (stat.isDirectory()) { if (!ASSETS.some(asset => asset.startsWith(rel + '/'))) throw new Error(`Unexpected release directory: ${rel}`); out.push(...await inventory(root,rel)); }
        else if (stat.isFile()) out.push(rel); else throw new Error(`Release special file refused: ${rel}`);
    }
    return out.sort();
}
export async function validateRelease(root: string): Promise<Manifest> {
    if (!(await lstat(root)).isDirectory()) throw new Error('Release must be an extracted directory');
    const m = JSON.parse(await readFile(join(root,'manifest.json'),'utf8')) as Manifest;
    const assets = ASSETS;
    if (m.format !== 3 || m.target !== 'linux-windows-x64' || m.bun !== '>=1.4.3' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(m.version) || !/^[a-f0-9]{64}$/.test(m.buildId) || !m.files || Object.keys(m.files).sort().join('\n') !== assets.join('\n')) throw new Error('Invalid release manifest/identity/assets');
    if ((await inventory(root)).join('\n') !== [...assets,'manifest.json'].sort().join('\n')) throw new Error('Unexpected or missing release files');
    for (const rel of assets) if (!/^[a-f0-9]{64}$/.test(m.files[rel]!) || sha256(await readFile(join(root,rel))) !== m.files[rel]) throw new Error(`Release checksum mismatch: ${rel}`);
    for (const rel of process.platform === 'win32' ? [] : ['standalone/cli.js', 'tools/notify-action']) if (!((await lstat(join(root,rel))).mode & 0o100)) throw new Error(`Release executable bit missing: ${rel}`);
    const identity = JSON.parse(await readFile(join(root,'dist/standalone/build.json'),'utf8'));
    if (identity.protocolVersion !== 1 || identity.buildId !== m.buildId || identity.version !== m.version) throw new Error('Frontend identity differs from release');
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (pkg.name !== '@tyvsmith/steam-native-notifications' || pkg.version !== m.version || pkg.private || pkg.type !== 'module' || pkg.bin?.snn !== 'standalone/cli.js' || pkg.engines?.bun !== m.bun || pkg.os?.join() !== 'linux,win32' || pkg.cpu?.join() !== 'x64') throw new Error('Invalid package metadata');
    if (JSON.stringify(pkg.scripts) !== JSON.stringify({ postinstall: 'bun standalone/cli.js setup --hook', preuninstall: 'bun standalone/cli.js teardown --hook' }) || pkg.dependencies || pkg.devDependencies || pkg.files?.slice().sort().join('\n') !== [...assets.filter(p => p !== 'package.json'), 'manifest.json'].sort().join('\n')) throw new Error('Unexpected package scripts, dependencies or files');
    return m;
}
