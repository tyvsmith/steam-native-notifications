import { developerCommand } from './developer-command';
import { usageFromHeader } from '../snn';
import { parseCommonOptions, printResult, printError } from '../cli-options';
export async function main(entry: string): Promise<void> {
    try {
        const options = parseCommonOptions(process.argv.slice(2));
        if (!options.args.length || ['--help', '-h'].includes(options.args[0]!)) { console.log(usageFromHeader(entry)); process.exitCode = 2; return; }
        printResult(await developerCommand(options.args, options.host), options.json);
    } catch (e: any) { printError(e, process.argv.includes('--json')); }
}
