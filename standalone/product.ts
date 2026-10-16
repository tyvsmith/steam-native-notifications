import { parseCommonOptions, printResult, printError } from './cli-options';
import { BUILD_IDENTITY } from '../shared/host';
import { runCli } from './cli';
import { daemonMain } from './daemon';
import { packageCommand } from './installer';
export async function productMain(argv=process.argv.slice(2)){
    const options=parseCommonOptions(argv);const {json}=options;const args=[...options.args];const command=args.shift();
    if(command==='--version'){console.log(JSON.stringify(BUILD_IDENTITY));return;}
    if(!command||['--help','-h'].includes(command)){console.log('Usage: snn [--json] install|upgrade --release DIR [--steam-dir DIR]\n       snn rollback|recover|uninstall|session\n       snn status|doctor|settings [--no-open]|capture [n]|dev fire ...\n       snn daemon [--config FILE] [--steam-dir DIR] [--port N]\nExit: 0 success, 1 failure. Local extracted releases only. Steam is never launched or stopped.');return;}
    if(command==='daemon'){process.argv=[process.argv[0]!,process.argv[1]!,...args];return daemonMain();}
    if(['install','upgrade','rollback','recover','uninstall','session'].includes(command)){const result=await packageCommand(command,args);printResult(result,json);return;}
    return runCli(argv,options);
}
if(import.meta.main)try{await productMain();}catch(e:any){printError(e,process.argv.includes('--json'));}
