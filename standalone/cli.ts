import { capture, fire, hostStatus, type HostSelection } from './client';
import { settingsCommand } from './settings-server';
import { planFire } from '../tools/lib/devtools';
export function parseCommonOptions(argv: string[]): { host: HostSelection; json: boolean; args: string[] } {
    let host: HostSelection = 'auto'; let json = false; const args: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--host') { const value = argv[++i]; if (!['auto', 'standalone', 'millennium'].includes(value ?? '')) throw new Error('--host must be auto, standalone or millennium'); host = value as HostSelection; }
        else if (argv[i] === '--json') json = true;
        else args.push(argv[i]!);
    }
    return { host, json, args };
}
export async function runCli(argv: string[]): Promise<void> {
    const { host, json, args } = parseCommonOptions(argv); let result: unknown;
    if (!args.length || ['--help', '-h'].includes(args[0]!)) { console.log('Usage: snn [--host auto|millennium|standalone] [--json] status|doctor|settings [--no-open]|capture [n]|dev fire <tools/fire arguments>'); return; }
    if (args[0] === 'settings') { if (args.slice(1).some(arg => arg !== '--no-open') || args.length > 2) throw new Error('Usage: snn settings [--no-open]'); await settingsCommand(args.includes('--no-open'), host); return; }
    if (['status', 'doctor'].includes(args[0]!)) { if (args.length !== 1) throw new Error('Unexpected status arguments'); result = await hostStatus(); }
    else if (args[0] === 'capture' && args.length <= 2) result = await capture(args[1] === undefined ? 8 : Number(args[1]), host);
    else if (args[0] === 'dev' && args[1] === 'fire') { const plan = planFire(args.slice(2)); if (plan.kind !== 'queue') throw new Error(plan.kind === 'error' ? plan.message : 'Missing developer command'); result = await fire(plan.command, host); }
    else throw new Error('Unknown command; use snn --help');
    console.log(JSON.stringify(result, null, json ? undefined : 2));
}
if (import.meta.main) { try { await runCli(process.argv.slice(2)); } catch (e: any) { console.error(e.message); process.exitCode = 1; } }
