import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { runtimeRoot } from './runtime-paths';

/** Local dependency lifecycle hooks must never change desktop integration. */
export async function setupHookAllowed(cli = join(runtimeRoot(), 'standalone/cli.js')): Promise<boolean> {
    const child = Bun.spawn([process.execPath, 'pm', 'bin', '--global'], { stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => child.kill(), 5000);
    try {
        const [output, , code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        if (code !== 0) return false;
        const directory = output.trim();
        if (!directory.startsWith('/')) return false;
        return await realpath(join(directory, 'snn')) === await realpath(cli);
    } catch { return false; }
    finally { clearTimeout(timer); }
}
