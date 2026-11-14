import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sourceBuildId } from './source-hash';

test('equivalent source checkouts ignore cache additions/content but retain source inputs', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'snn identity '));
    try {
        const first = join(temp, 'first'), second = join(temp, 'second');
        for (const dir of ['frontend/generated', 'shared', 'standalone', 'backend', 'tools']) await mkdir(join(first, dir), { recursive: true });
        await writeFile(join(first, 'package.json'), '{"version":"0.1.0"}');
        for (const file of ['bun.lock', 'millennium.toml', 'tsconfig.json']) await writeFile(join(first, file), 'original');
        await writeFile(join(first, 'tools/helper'), '#!/bin/sh\ntrue\n');
        await writeFile(join(first, 'frontend/generated/notifications.ts'), 'export const generated = 1;');
        await cp(first, second, { recursive: true });
        const original = await sourceBuildId(first);
        expect(await sourceBuildId(first)).toEqual(original);
        for (const file of ['bun.lock', 'millennium.toml', 'tsconfig.json']) {
            await writeFile(join(first, file), 'changed');
            expect(await sourceBuildId(first)).not.toBe(original);
            await writeFile(join(first, file), 'original');
            expect(await sourceBuildId(first)).toEqual(original);
        }
        expect(await sourceBuildId(first, `${Bun.version}-different`)).not.toBe(original);
        await mkdir(join(second, 'tools/__pycache__'), { recursive: true });
        await writeFile(join(second, 'tools/__pycache__/game-focus.cpython-314.pyc'), 'cache one');
        await writeFile(join(second, 'tools/other.pyc'), 'bytecode');
        await mkdir(join(second, 'standalone/dist'), { recursive: true });
        await writeFile(join(second, 'standalone/dist/bundle.js'), 'build output');
        expect(await sourceBuildId(second)).toEqual(original);
        await writeFile(join(second, 'tools/__pycache__/game-focus.cpython-314.pyc'), 'different cache');
        expect(await sourceBuildId(second)).toEqual(original);
        await writeFile(join(second, 'tools/new-untracked-source.ts'), 'export const newSource = true;');
        expect(await sourceBuildId(second)).not.toBe(original);
        await writeFile(join(first, 'tools/helper'), '#!/bin/sh\nfalse\n');
        expect(await sourceBuildId(first)).not.toBe(original);
        await writeFile(join(first, 'tools/helper'), '#!/bin/sh\ntrue\n');
        await writeFile(join(first, 'frontend/generated/notifications.ts'), 'export const generated = 2;');
        expect(await sourceBuildId(first)).not.toBe(original);
    } finally { await rm(temp, { recursive: true, force: true }); }
});
