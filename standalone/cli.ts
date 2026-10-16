import { daemonMain } from './daemon';
import { packageCommand } from './installer';
import { capture, fire, hostStatus } from './client';
import { settingsCommand } from './settings-server';
import { planFire } from '../tools/lib/devtools';
import { parseCommonOptions, printResult, printError } from './cli-options';
import { dependencies } from './dependencies';
import { BUILD_IDENTITY } from '../shared/host';
import { selectHost } from './client';
async function runClientCommand(options: ReturnType<typeof parseCommonOptions>): Promise<void> {
    const { host, hostExplicit, json, args } = options;
    let result: unknown;
    if (args[0] === 'settings') { if (args.slice(1).some(arg => arg !== '--no-open') || args.length > 2) throw new Error('Usage: snn settings [--no-open]'); const selected = hostExplicit ? await selectHost(host) : 'standalone'; await settingsCommand(args.includes('--no-open'), selected, json); return; }
    if (['status', 'doctor'].includes(args[0]!)) { if (args.length !== 1) throw new Error('Unexpected status arguments'); const hosts = (await hostStatus()).filter(s => host === 'auto' || s.host === host); result = hosts; if (args[0] === 'doctor') { const deps = dependencies(); result = { build: BUILD_IDENTITY, dependencies: deps, hosts }; if (deps.delivery !== 'available' || !hosts.some(s => s.present && !['failed','degraded','stopped'].includes(s.state) && !s.config?.error)) process.exitCode = 1; } }
    else if (args[0] === 'capture' && args.length <= 2) result = await capture(args[1] === undefined ? 8 : Number(args[1]), host);
    else if (args[0] === 'dev' && args[1] === 'fire') { const plan = planFire(args.slice(2)); if (plan.kind !== 'queue') throw new Error(plan.kind === 'error' ? plan.message : 'Missing developer command'); result = await fire(plan.command, host); }
    else throw new Error('Unknown command; use snn --help');
    printResult(result, json);
}
export async function main(argv = process.argv.slice(2)): Promise<void> {
    const options = parseCommonOptions(argv);
    const [command, ...args] = options.args;
    if (command === '--version') {
        console.log(JSON.stringify(BUILD_IDENTITY));
        return;
    }
    if (!command || ['--help', '-h'].includes(command)) {
        console.log(`Usage: snn [--host auto|millennium|standalone] [--json] <command>
       snn install|upgrade --release DIR [--steam-dir DIR]
       snn rollback|recover|uninstall|session
       snn status|doctor|settings [--no-open]|capture [n]|dev fire ...
       snn daemon [--config FILE] [--steam-dir DIR] [--port N]
Exit: 0 success, 1 failure. Local extracted releases only. Steam is never launched or stopped.`);
        return;
    }
    if (command === 'daemon') {
        process.argv = [process.argv[0]!, process.argv[1]!, ...args];
        return daemonMain();
    }
    if (['install', 'upgrade', 'rollback', 'recover', 'uninstall', 'session'].includes(command)) {
        printResult(await packageCommand(command, args), options.json);
        return;
    }
    return runClientCommand(options);
}
if (import.meta.main) {
    try { await main(); }
    catch (error) { printError(error, process.argv.includes('--json')); }
}
