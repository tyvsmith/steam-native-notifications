import { readFile, writeFile, unlink, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { discoverSteam, exists, type Paths } from './paths';
import { runtimeRoot } from './runtime-paths';
import { BUILD_IDENTITY } from '../shared/host';
import { DEFAULTS } from '../shared/settings';
import { controlCall } from './control';
import { exclusiveFile, powershell, privateDirectory, psQuote } from './windows';
async function atomic(path: string, value: unknown) { const temp = path + '.' + crypto.randomUUID(); await writeFile(temp, JSON.stringify(value)); await rename(temp, path); }
const TASK = 'Steam Native Notifications-' + createHash('sha256').update(homedir().toLowerCase()).digest('hex').slice(0, 12);
export function taskSource(bun: string, cli: string, steam: string, config: string, launchId: string = crypto.randomUUID(), enabled = true): string {
    const args = ['"' + cli + '"', 'daemon', '--steam-dir', '"' + steam + '"', '--config', '"' + config + '"'].join(' ');
    if ([bun, cli, steam, config].some(p => /["\r\n\0]/.test(p))) throw new Error('Unsupported runtime path');
    const launchFile = config + '.launch';
    const launch = `$p=Start-Process -FilePath ${psQuote(bun)} -ArgumentList ${psQuote(args)} -WindowStyle Hidden -PassThru; [IO.File]::WriteAllText(${psQuote(launchFile)}, (@{id=${psQuote(launchId)};pid=$p.Id}|ConvertTo-Json -Compress)); $p.WaitForExit(); exit $p.ExitCode`;
    const command = '-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + Buffer.from(launch, 'utf16le').toString('base64');
    return `$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name; $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${psQuote(command)}; $trigger=New-ScheduledTaskTrigger -AtLogOn -User $user; $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited; $settings=New-ScheduledTaskSettingsSet ${enabled ? '' : '-Disable '} -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; Register-ScheduledTask -TaskName ${psQuote(TASK)} -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Steam Native Notifications standalone integration' -Force | Out-Null`;
}
export async function windowsIntegration(command: string, args: string[], p: Paths, stop = true): Promise<unknown> {
    let steamOption: string | undefined;
    if (command === 'setup' && args.length === 2 && args[0] === '--steam-dir') steamOption = args[1];
    else if (args.length) throw new Error('Unexpected integration options');
    const directory = dirname(p.state);
    await privateDirectory(directory);
    const unlock = await exclusiveFile(p.state + '.lock', 0);
    try {
        const old = await exists(p.state) ? JSON.parse(await readFile(p.state, 'utf8')) : undefined;
        const enabled = await powershell(`$t=Get-ScheduledTask -TaskName ${psQuote(TASK)} -ErrorAction SilentlyContinue; if($t){[string]$t.Settings.Enabled}`) !== 'False';
        const running = await powershell(`$t=Get-ScheduledTask -TaskName ${psQuote(TASK)} -ErrorAction SilentlyContinue; if($t){[string]($t.State -eq 'Running')}`) === 'True';
        const current = await powershell(`$t=Get-ScheduledTask -TaskName ${psQuote(TASK)} -ErrorAction SilentlyContinue; if($t){Export-ScheduledTask -TaskName ${psQuote(TASK)}}`);
        const journal = p.state + '.transaction';
        const restore = async (snapshot: { task: string; running: boolean }) => {
            await powershell(`Stop-ScheduledTask -TaskName ${psQuote(TASK)} -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName ${psQuote(TASK)} -Confirm:$false -ErrorAction SilentlyContinue; ${snapshot.task ? `Register-ScheduledTask -TaskName ${psQuote(TASK)} -Xml ${psQuote(snapshot.task)} | Out-Null; ${snapshot.running ? `Start-ScheduledTask -TaskName ${psQuote(TASK)}` : ''}` : ''}`);
        };
        if (await exists(journal)) {
            if (command !== 'recover') throw new Error('Interrupted Windows setup; run snn recover');
            const snapshot = JSON.parse(await readFile(journal, 'utf8'));
            if (typeof snapshot.task !== 'string' || typeof snapshot.running !== 'boolean' || (snapshot.after !== undefined && typeof snapshot.after !== 'string')) throw new Error('Invalid Windows recovery journal');
            if (current && current !== snapshot.task && current !== snapshot.after) throw new Error('Task changed during setup; recovery refuses to replace it');
            await restore(snapshot);
            if (snapshot.state) await atomic(p.state, snapshot.state); else if (await exists(p.state)) await unlink(p.state);
            await unlink(journal);
            return { recovered: true };
        }
        if (current && (!old || old.task !== current)) throw new Error('Unowned or modified scheduled task; refusing to replace it');
        if (old && (old.version !== 1 || typeof old.task !== 'string' || typeof old.steam !== 'string')) throw new Error('Invalid Windows integration state');
        if (command === 'recover') return { recovered: false };
        if (command === 'teardown') {
            if (!old) return { removed: false };
            if (current) await powershell(`${stop ? `Stop-ScheduledTask -TaskName ${psQuote(TASK)};` : ''} Unregister-ScheduledTask -TaskName ${psQuote(TASK)} -Confirm:$false`);
            // AUMID is shared with Millennium; preserve its branding on standalone removal.
            await unlink(p.state);
            return { removed: true, restartNeeded: true, preserved: [p.config] };
        }
        if (command === 'session') { if (!old) throw new Error('Run snn setup first'); await powershell(`Start-ScheduledTask -TaskName ${psQuote(TASK)}`); return { session: 'activated' }; }
        if (command !== 'setup') throw new Error('Unknown integration command');
        const steam = await discoverSteam(p, steamOption ?? old?.steam);
        if (old && old.steam !== steam) throw new Error('Steam root change refused; teardown first');
        const root = runtimeRoot(), cli = join(root, 'standalone/cli.js');
        if (!await exists(cli)) throw new Error('Install the built Bun package before setup');
        const runtime = join(p.cacheHome, 'steam-native-notifications');
        await privateDirectory(runtime);
        if (!await exists(p.config)) await writeFile(p.config, JSON.stringify(DEFAULTS, null, 2));
        const marker = join(steam, '.cef-enable-remote-debugging');
        if (!await exists(marker)) await writeFile(marker, '', { flag: 'wx' });
        const launchId = crypto.randomUUID();
        const transaction = { task: current, running, state: old ?? null, after: '' };
        await atomic(journal, transaction);
        try {
            if (current) await powershell(`Stop-ScheduledTask -TaskName ${psQuote(TASK)}`);
            await powershell(taskSource(process.execPath, cli, steam, p.config, launchId, enabled));
            transaction.after = await powershell(`Export-ScheduledTask -TaskName ${psQuote(TASK)}`);
            await atomic(journal, transaction);
            if (!old || running) await powershell(`Start-ScheduledTask -TaskName ${psQuote(TASK)}`);
            const deadline = Date.now() + 10000; let ready = !!old && !running;
            while (!ready && Date.now() < deadline) { try { const status = await controlCall('status', undefined, { timeoutMs: 500 }); const launched = JSON.parse(await readFile(p.config + '.launch', 'utf8')); if (launched.id === launchId && Number.isSafeInteger(launched.pid) && launched.pid > 0 && status.pid === launched.pid && status.build?.buildId === BUILD_IDENTITY.buildId) { ready = true; break; } } catch {} await Bun.sleep(200); }
            if (!ready) throw new Error('Windows daemon did not become ready');
            const task = await powershell(`Export-ScheduledTask -TaskName ${psQuote(TASK)}`);
            await atomic(p.state, { version: 1, steam, task });
            await unlink(journal);
            return { steam, activation: !old || running ? 'verified' : 'staged; task remains stopped', restartNeeded: true };
        } catch (error) {
            await restore({ task: current, running });
            if (old) await atomic(p.state, old); else if (await exists(p.state)) await unlink(p.state);
            await unlink(journal);
            throw error;
        }
    } finally { unlock(); }
}
