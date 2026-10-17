import { daemonMain } from './daemon';
import { integrationCommand } from './installer';
import { configCommand } from './config-cli';
import { setupHookAllowed } from './setup-hook';
import { capture, sample, hostStatus } from '../tools/lib/host-client';
import { developerCommand } from '../tools/lib/cli/developer-command';
import { parseCommonOptions, printResult, printError } from '../tools/lib/cli-options';
import { dependencies } from './dependencies';
import { BUILD_IDENTITY } from '../shared/host';
async function runClientCommand(options: ReturnType<typeof parseCommonOptions>): Promise<void> {
    const { host, json, args } = options;
    let result: unknown;
    if (['status', 'doctor'].includes(args[0]!)) { if (args.length !== 1) throw new Error('Unexpected status arguments'); const hosts = (await hostStatus()).filter(s => host === 'auto' || s.host === host); result = hosts; if (args[0] === 'doctor') { const deps = dependencies(); result = { build: BUILD_IDENTITY, dependencies: deps, hosts }; if (deps.delivery !== 'available' || !hosts.some(s => s.present && !['failed','degraded','stopped'].includes(s.state) && !s.config?.error)) process.exitCode = 1; } }
    else if (args[0] === 'capture' && args.length <= 2) result = await capture(args[1] === undefined ? 8 : Number(args[1]), host);
    else if (args[0] === 'sample' && args.length === 1) result = await sample(host);
    else if (args[0] === 'dev' && ['fire', 'replay', 'server'].includes(args[1]!)) result = await developerCommand(args[1] === 'fire' ? args.slice(2) : [`--${args[1]}`, ...args.slice(2)], host);
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
       snn setup [--steam-dir DIR]
       snn teardown|recover
       snn config get [KEY]|set KEY true|false|reset [--config FILE]
       snn status|doctor|capture [n]|sample
       snn dev fire NAME [JSON ...]|replay inspect|invoke [NAME]|server TYPE [JSON]
       snn session
       snn daemon [--config FILE] [--steam-dir DIR] [--port N]
Exit: 0 success, 1 failure. Bun owns package installation and updates. Settings are in Steam → Notifications.
Run teardown before removing the Bun package. Steam is never launched or stopped.`);
        return;
    }
    if (command === 'daemon') {
        process.argv = [process.argv[0]!, process.argv[1]!, ...args];
        return daemonMain();
    }
    if (command === 'config') {
        printResult(await configCommand(args, undefined, options.host), options.json);
        return;
    }
    if (['setup', 'teardown', 'recover', 'session'].includes(command)) {
        if (options.hostExplicit && options.host !== 'standalone') throw new Error('Integration setup targets standalone only');
        const hook = ['setup', 'teardown'].includes(command) && args.includes('--hook');
        if (hook && !await setupHookAllowed()) {
            console.error(`Desktop ${command} skipped: this package is not the global snn command.`);
            return;
        }
        try {
            printResult(await integrationCommand(command as 'setup' | 'teardown' | 'recover' | 'session', hook ? args.filter(arg => arg !== '--hook') : args), options.json);
        } catch (error) {
            if (!hook || command !== 'setup') throw error;
            console.error(`Package installed; desktop setup is pending: ${error instanceof Error ? error.message : error}. Run snn setup from your graphical session.`);
        }
        return;
    }
    return runClientCommand(options);
}
if (import.meta.main) {
    try { await main(); }
    catch (error) { printError(error, process.argv.includes('--json')); }
}
