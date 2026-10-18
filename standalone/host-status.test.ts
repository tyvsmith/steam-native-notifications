import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('host discovery accepts a responsive standalone status after a slow renderer health challenge', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snn-status-'));
    // Isolate the unrelated Millennium mock from every other test module.
    const source = `
        import { mock } from 'bun:test';
        import { startControl } from ${JSON.stringify(resolve(import.meta.dir, 'control.ts'))};
        mock.module(${JSON.stringify(resolve(import.meta.dir, '../tools/lib/mep.ts'))}, () => ({
            mepCall: async () => { throw Object.assign(new Error('No Millennium fixture'), { code: 'ENOENT' }); }
        }));
        const { hostStatus, operationEligible, selectConfigHost } = await import(${JSON.stringify(resolve(import.meta.dir, '../tools/lib/host-client.ts'))});
        let budget;
        const stop = await startControl(async request => {
            if (request.operation !== 'status') throw new Error('Unexpected mutation');
            budget = request.deadline - Date.now();
            await Bun.sleep(1600);
            return { host: 'standalone', state: 'ready', capabilities: { settingsWrite: true, sample: true, developerCommands: true } };
        });
        try {
            const statuses = await hostStatus();
            const standalone = statuses.find(status => status.host === 'standalone');
            console.log(JSON.stringify({ status: standalone, budget, sampleEligible: operationEligible(standalone, 'sample'), configHost: selectConfigHost(statuses) }));
        } finally { await stop(); }
    `;
    try {
        const child = Bun.spawn([process.execPath, '-e', source], {
            env: { ...process.env, XDG_RUNTIME_DIR: dir }, stdout: 'pipe', stderr: 'pipe',
        });
        const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(errors).toBe(''); expect(code).toBe(0);
        const result = JSON.parse(output);
        expect(result.status).toMatchObject({ host: 'standalone', present: true, state: 'ready' });
        expect(result.sampleEligible).toBe(true); expect(result.configHost).toBe('standalone');
        expect(result.budget).toBeGreaterThan(4500);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
