import { mkdir, cp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ASSETS, sha256, validateRelease, type Manifest } from '../standalone/package-manifest';
import { BUILD_IDENTITY } from '../shared/host';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const toml = await readFile('millennium.toml', 'utf8');
if (toml.match(/^version\s*=\s*"([^"]+)"/m)?.[1] !== pkg.version || BUILD_IDENTITY.version !== pkg.version) throw new Error('Version metadata differs');
const name = `snn-${pkg.version}-${BUILD_IDENTITY.buildId.slice(0, 12)}`;
const root = resolve('dist/releases', name);
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
const build = await Bun.build({ entrypoints: ['standalone/cli.ts'], target: 'bun', format: 'esm', outdir: join(root, 'standalone'), naming: 'cli.js' });
if (!build.success) throw new AggregateError(build.logs, 'CLI bundle failed');
const cli = join(root, 'standalone/cli.js');
await writeFile(cli, '#!/usr/bin/env bun\n' + (await readFile(cli, 'utf8')).replace(/^#![^\n]*\n/, ''));
await chmod(cli, 0o755);
for (const rel of ASSETS.filter(p => !['standalone/cli.js', 'package.json'].includes(p))) {
    await mkdir(join(root, rel, '..'), { recursive: true });
    await cp(rel, join(root, rel));
}
await writeFile(join(root, 'package.json'), JSON.stringify({
    name: '@tyvsmith/steam-native-notifications', version: pkg.version,
    description: pkg.description, license: pkg.license, author: pkg.author,
    type: 'module', bin: { snn: 'standalone/cli.js' }, engines: { bun: '>=1.4.3' },
    os: ['linux'], cpu: ['x64'],
    repository: { type: 'git', url: 'https://github.com/tyvsmith/steam-native-notifications.git' },
    publishConfig: { access: 'public' },
    files: [...ASSETS.filter(p => p !== 'package.json'), 'manifest.json'].sort(),
    scripts: { postinstall: 'bun standalone/cli.js setup --hook' },
}, null, 2) + '\n');
const manifest: Manifest = { format: 3, version: pkg.version, buildId: BUILD_IDENTITY.buildId, target: 'linux-x64', bun: '>=1.4.3', files: {} };
for (const rel of ASSETS) manifest.files[rel] = sha256(await readFile(join(root, rel)));
await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await validateRelease(root);
const tar = resolve('dist/releases', `${name}.tgz`);
const child = Bun.spawn([process.execPath, 'pm', 'pack', '--ignore-scripts', '--filename', tar], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
if (await child.exited) throw new Error('Package pack failed');
await writeFile(`${tar}.sha256`, `${sha256(await readFile(tar))}  ${name}.tgz\n`);
console.log(JSON.stringify({ root, tar }));
