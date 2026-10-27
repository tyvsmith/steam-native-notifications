import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('offline frontend loading needs no compiler executable or working-directory convention', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'snn frontend spaces '));
    const loader = pathToFileURL(join(import.meta.dir, 'load-frontend.mjs')).href;
    try {
        const script = `const {loadFrontendModules}=await import(${JSON.stringify(loader)});
            const {routes}=loadFrontendModules(['routes']);
            console.log(routes.clientRoute(1,{appid:570}));`;
        const child = Bun.spawn([process.execPath, '--eval', script], {
            cwd, env: { ...process.env, PATH: '' }, stdout: 'pipe', stderr: 'pipe',
        });
        const [output, error, code] = await Promise.all([
            new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
        ]);
        expect({code, error}).toEqual({code: 0, error: ''});
        expect(output.trim()).toBe('steam://nav/games/details/570');
    } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('offline frontend loading refuses the live Millennium adapter', async () => {
    const loader = pathToFileURL(join(import.meta.dir, 'load-frontend.mjs')).href;
    const child = Bun.spawn([process.execPath, '--eval', `const {loadFrontendModules}=await import(${JSON.stringify(loader)});
        loadFrontendModules(['host']);`], { stdout: 'pipe', stderr: 'pipe' });
    const [error, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(code).not.toBe(0);
    expect(error).toContain("Cannot find package 'millennium'");
});
