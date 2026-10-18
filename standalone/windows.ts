import { dlopen, FFIType, ptr } from 'bun:ffi';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

export const psQuote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
/** Encoded source contains only fixed code and quoted data, never notification text. */
export function powershell(source: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " + source, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = ''; const timer = setTimeout(() => child.kill(), 15000);
        child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
        child.once('error', e => { clearTimeout(timer); reject(e); });
        child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `PowerShell exited ${code}`)); });
    });
}
/** Remove inherited grants before storing control credentials or payloads. */
export async function privateDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
    await powershell(`$p=${psQuote(path)}; $item=Get-Item -LiteralPath $p; if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Unsafe runtime directory'}; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); foreach($id in @($sid,[Security.Principal.SecurityIdentifier]'S-1-5-18')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}; Set-Acl -LiteralPath $p -AclObject $acl`);
}
/** Exclusive kernel handle releases on process death, unlike a PID/lock directory. */
export async function exclusiveFile(path: string, timeoutMs: number): Promise<() => void> {
    const api = dlopen('kernel32.dll', {
        CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u64], returns: FFIType.u64 },
        CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
        GetLastError: { args: [], returns: FFIType.u32 },
    });
    const name = Buffer.from(path + '\0', 'utf16le'); const until = Date.now() + timeoutMs;
    while (true) {
        const handle = api.symbols.CreateFileW(ptr(name), 0xC0000000, 0, null, 4, 0x00200080, 0);
        if (BigInt(handle) !== 0xffffffffffffffffn) return () => { api.symbols.CloseHandle(handle); api.close(); };
        const error = api.symbols.GetLastError();
        if (error !== 32 || Date.now() >= until) { api.close(); throw new Error(`Cannot acquire exclusive lock (${error}); another writer may be running`); }
        await Bun.sleep(20);
    }
}
