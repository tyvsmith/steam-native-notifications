import { dlopen, FFIType, ptr } from 'bun:ffi';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

// PowerShell 7's module search path is incompatible with Windows PowerShell 5.1.
export const powershellEnvironment = () => ({ ...process.env, PSModulePath: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') });
export const psQuote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
/** Encoded source contains only fixed code and quoted data, never notification text. */
export function powershell(source: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " + source + '; exit 0', 'utf16le').toString('base64')], { env: powershellEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = ''; const timer = setTimeout(() => child.kill(), 15000);
        child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
        child.once('error', e => { clearTimeout(timer); reject(e); });
        child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `PowerShell exited ${code}`)); });
    });
}
/** Remove inherited grants before storing control credentials or payloads. */
export async function privateDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
    await powershell(`$p=${psQuote(path)}; $item=Get-Item -LiteralPath $p; if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Unsafe runtime directory'}; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); foreach($id in @($sid,[Security.Principal.SecurityIdentifier]'S-1-5-18')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}; $item.SetAccessControl($acl)`);
}
// Keep native function wrappers alive while the process can acquire locks.
const openKernel32 = () => dlopen('kernel32.dll', {
    CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u64], returns: FFIType.u64 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    GetLastError: { args: [], returns: FFIType.u32 },
});
let kernel32: ReturnType<typeof openKernel32> | undefined;
/** Exclusive kernel handle releases on process death, unlike a PID/lock directory. */
export async function exclusiveFile(path: string, timeoutMs: number): Promise<() => void> {
    const api = kernel32 ??= openKernel32();
    const name = Buffer.from(path + '\0', 'utf16le'); const until = Date.now() + timeoutMs;
    while (true) {
        const handle = api.symbols.CreateFileW(ptr(name), 0xC0000000, 0, null, 4, 0x00200080, 0);
        if (BigInt(handle) !== 0xffffffffffffffffn) {
            let closed = false;
            return () => { if (!closed) { closed = true; api.symbols.CloseHandle(handle); } };
        }
        const error = api.symbols.GetLastError();
        if (error !== 32 || Date.now() >= until) { throw new Error(`Cannot acquire exclusive lock (${error}); another writer may be running`); }
        await Bun.sleep(20);
    }
}
