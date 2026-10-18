import { readFile, readdir, readlink } from 'node:fs/promises';
import { basename, join, win32 } from 'node:path';
import { endpoint, targetSocket } from './cdp';
export type Listener = { address: string; inode: string; loopback: boolean };
export function parseListeners(text: string, port: number, ipv6 = false): Listener[] {
    return text.trim().split('\n').slice(1).flatMap(line => {
        const columns = line.trim().split(/\s+/);
        const [address, rawPort] = (columns[1] ?? '').split(':');
        if (columns[3] !== '0A' || parseInt(rawPort ?? '', 16) !== port) return [];
        return [{ address: address!, inode: columns[9]!, loopback: ipv6 ? address === '00000000000000000000000001000000' : address === '0100007F' }];
    });
}
async function listeners(port: number): Promise<Listener[]> {
    const tables = await Promise.all(['tcp', 'tcp6'].map(async (name, index) => {
        try { return parseListeners(await readFile(`/proc/net/${name}`, 'utf8'), port, index === 1); }
        catch (error: any) { if (name === 'tcp6' && error.code === 'ENOENT') return []; throw error; }
    }));
    return tables.flat();
}
async function steamOwner(inode: string): Promise<boolean> {
    for (const pid of (await readdir('/proc')).filter(pid => /^\d+$/.test(pid))) {
        try {
            if (basename(await readlink(`/proc/${pid}/exe`)) !== 'steamwebhelper') continue;
            const directory = `/proc/${pid}/fd`;
            for (const fd of await readdir(directory)) {
                try { if (await readlink(join(directory, fd)) === `socket:[${inode}]`) return true; } catch { /* process/socket closed */ }
            }
        } catch { /* other users, exited or inaccessible processes */ }
    }
    return false;
}
export type Inspection = { kind: 'missing' | 'conflict' | 'unsafe' | 'steam'; message: string; targets?: any[] };
type InspectionDependencies = { listeners: typeof listeners; steamOwner: typeof steamOwner; fetch: typeof fetch };
/** Inspect the listener and its process in the interactive user's session before CDP discovery. */
export function windowsInspectionDependencies(steamRoot: string, run: (source: string) => Promise<string>): InspectionDependencies {
    const owned = new Set<string>();
    return {
        fetch: globalThis.fetch,
        steamOwner: async pid => owned.has(pid),
        listeners: async port => {
            endpoint(port); // Validate before interpolating the numeric port into PowerShell.
            owned.clear();
            if (!win32.isAbsolute(steamRoot)) throw new Error('Steam root is unavailable');
            const result = JSON.parse(await run(`
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$session=(Get-Process -Id $PID).SessionId
$rows=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq ${port} | ForEach-Object {
    $connection=$_; $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$connection.OwningProcess) -ErrorAction Stop
    $owner=if($process){Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid -ErrorAction Stop}else{$null}
    [pscustomobject]@{address=$connection.LocalAddress; pid=$connection.OwningProcess; executable=$process.ExecutablePath; session=$process.SessionId; sid=if($owner.ReturnValue -eq 0){$owner.Sid}else{$null}}
})
ConvertTo-Json -Compress -Depth 4 -InputObject @{sid=$sid; session=$session; listeners=$rows}`));
            if (!result || typeof result.sid !== 'string' || !result.sid || !Number.isSafeInteger(result.session) || result.session <= 0 || !Array.isArray(result.listeners)) throw new Error('Invalid listener inspection');
            return result.listeners.map((row: any): Listener => {
                if (!row || typeof row.address !== 'string' || !Number.isSafeInteger(row.pid) || row.pid <= 0) throw new Error('Invalid listener');
                const relative = typeof row.executable === 'string' && win32.isAbsolute(row.executable)
                    ? win32.relative(steamRoot, row.executable) : '..';
                if (relative && relative !== '..' && !relative.startsWith('..\\') && !win32.isAbsolute(relative)
                    && win32.basename(relative).toLowerCase() === 'steamwebhelper.exe'
                    && row.sid === result.sid && row.session === result.session) owned.add(String(row.pid));
                return { address: row.address, inode: String(row.pid), loopback: row.address === '127.0.0.1' || row.address === '::1' };
            });
        },
    };
}
export async function inspectEndpoint(port = 8080, dependencies?: InspectionDependencies, steamRoot?: string): Promise<Inspection> {
    const base = endpoint(port);
    dependencies ??= process.platform === 'win32'
        ? windowsInspectionDependencies(steamRoot ?? '', (await import('./windows')).powershell)
        : { listeners, steamOwner, fetch: globalThis.fetch };
    let active: Listener[];
    try { active = await dependencies.listeners(port); }
    catch { return { kind: 'unsafe', message: `Cannot inspect listeners; verify that ${port} is loopback-only and owned by steamwebhelper in your session. No injection attempted.` }; }
    if (!active.length) return { kind: 'missing', message: `No debugging listener on ${port}. Enable the CEF marker in the native Steam root, then fully exit and launch plain steam yourself. No automatic Steam restart.` };
    if (active.some(listener => !listener.loopback)) return { kind: 'unsafe', message: `Port ${port} has a non-loopback listener; refusing injection. Remove externally configured debug bind/forwarding.` };
    if (!await Promise.all(active.map(listener => dependencies.steamOwner(listener.inode))).then(values => values.every(Boolean)))
        return { kind: 'conflict', message: `Port ${port} is not verifiably owned by steamwebhelper. Resolve the listener conflict; the persistent marker uses 8080, it cannot select another port.` };
    try {
        const response = await dependencies.fetch(`${base}/json/list`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const targets = await response.json();
        if (!Array.isArray(targets) || !targets.some(target => targetSocket(target, port)))
            return { kind: 'conflict', message: `Listener responds but exposes no valid Steam UI target. Wait for SharedJSContext, check the client version, and ensure this is Steam CEF rather than another browser.` };
        return { kind: 'steam', message: `Loopback steamwebhelper listener on ${port}; valid Steam UI target advertised.`, targets };
    } catch (error: any) { return { kind: 'conflict', message: `Debug discovery failed: ${error.message}. Check ${base}/json/list and the listener; redirects are refused.` }; }
}
