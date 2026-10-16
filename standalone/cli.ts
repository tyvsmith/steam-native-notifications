import { capture, fire, hostStatus } from './client';
import { settingsCommand } from './settings-server';
import { planFire } from '../tools/lib/devtools';
import { parseCommonOptions, printResult, printError } from './cli-options';
export { parseCommonOptions } from './cli-options';
import { dependencies } from './dependencies';
import { BUILD_IDENTITY } from '../shared/host';
import { selectHost } from './client';
export async function runCli(argv: string[], options = parseCommonOptions(argv)): Promise<void> {
    const { host, hostExplicit, json, args } = options; let result: unknown;
    if (!args.length || ['--help', '-h'].includes(args[0]!)) { console.log('Usage: snn [--host auto|millennium|standalone] [--json] status|doctor|settings [--no-open]|capture [n]|dev fire <tools/fire arguments>'); return; }
    if (args[0] === 'settings') { if (args.slice(1).some(arg => arg !== '--no-open') || args.length > 2) throw new Error('Usage: snn settings [--no-open]'); const selected = hostExplicit ? await selectHost(host) : 'standalone'; await settingsCommand(args.includes('--no-open'), selected, json); return; }
    if (['status', 'doctor'].includes(args[0]!)) { if (args.length !== 1) throw new Error('Unexpected status arguments'); const hosts = (await hostStatus()).filter(s => host === 'auto' || s.host === host); result = hosts; if (args[0] === 'doctor') { const deps = dependencies(); result = { build: BUILD_IDENTITY, dependencies: deps, hosts }; if (deps.delivery !== 'available' || !hosts.some(s => s.present && !['failed','degraded','stopped'].includes(s.state) && !s.config?.error)) process.exitCode = 1; } }
    else if (args[0] === 'capture' && args.length <= 2) result = await capture(args[1] === undefined ? 8 : Number(args[1]), host);
    else if (args[0] === 'dev' && args[1] === 'fire') { const plan = planFire(args.slice(2)); if (plan.kind !== 'queue') throw new Error(plan.kind === 'error' ? plan.message : 'Missing developer command'); result = await fire(plan.command, host); }
    else throw new Error('Unknown command; use snn --help');
    printResult(result, json);
}
if (import.meta.main) { try { await runCli(process.argv.slice(2)); } catch (e: any) { printError(e, process.argv.includes('--json')); } }
