import { planFire } from '../devtools';
import { fire, sample, type HostSelection } from '../host-client';

/** Both command-line entrypoints share validation and host dispatch. */
export async function developerCommand(args: string[], host: HostSelection): Promise<unknown> {
    if (args.length === 1 && args[0] === '--sample') return sample(host);
    const plan = planFire(args);
    if (plan.kind !== 'queue') throw new Error(plan.kind === 'error' ? plan.message : 'Missing developer command');
    return fire(plan.command, host);
}
