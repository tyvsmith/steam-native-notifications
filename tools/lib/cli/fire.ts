import { planFire } from '../devtools';
import { usageFromHeader } from '../snn';
import { fire } from '../../../standalone/client';
import { parseCommonOptions } from '../../../standalone/cli-options';
export async function main(entry: string): Promise<void> {
    try {
        const options = parseCommonOptions(process.argv.slice(2)); const plan = planFire(options.args);
        if (plan.kind === 'usage') { console.log(usageFromHeader(entry)); process.exitCode = 2; return; }
        if (plan.kind === 'error') throw new Error(plan.message);
        console.log(JSON.stringify(await fire(plan.command, options.host), null, options.json ? undefined : 2));
    } catch (e: any) { console.error(e.message); process.exitCode = 1; }
}
