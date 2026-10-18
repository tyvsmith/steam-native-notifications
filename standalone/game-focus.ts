import { spawn } from 'node:child_process';
import { powershellEnvironment } from './windows';
/** No idle process: each click/diagnostic owns one bounded probe. */
export function windowsGameFocus(helper: string, steam: string, appid: number): Promise<string> {
    if (!Number.isInteger(appid) || appid <= 0 || appid > 0xffffffff) return Promise.resolve('unknown');
    return new Promise(resolve => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-AppId', String(appid), '-SteamDir', steam], { env: powershellEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        let output = '';
        const timer = setTimeout(() => { child.kill(); resolve('unknown'); }, 2000);
        child.stdout.on('data', data => { output += data; if (output.length > 64) { child.kill(); resolve('unknown'); } });
        child.once('error', () => { clearTimeout(timer); resolve('unknown'); });
        child.once('close', code => { clearTimeout(timer); const verdict = output.trim(); resolve(code === 0 && ['game', 'desktop'].includes(verdict) ? verdict : 'unknown'); });
    });
}
