// tools/fire, minus the usage header that stays in the entrypoint
// (usageFromHeader reads it from there).
import { existsSync } from 'node:fs';
import { planFire } from '../devtools';
import { PLUGIN_ID, starPath, usageFromHeader, writeDevFire } from '../snn';

// `entry` is the extensionless entrypoint that imported this module.
export async function main(entry: string): Promise<void> {

	const plan = planFire(process.argv.slice(2));
	if (plan.kind === 'usage') {
		console.log(usageFromHeader(entry));
		process.exit(2);
	}
	if (plan.kind === 'error') {
		console.error(plan.message);
		process.exit(1);
	}

	// Writing without the plugin installed would queue into a void while still
	// printing "queued", hence the .star check.
	const star = starPath();
	if (!star || !existsSync(star)) {
		console.error(`not installed: ${star ? `${star} does not exist` : `no Steam install found for ${PLUGIN_ID}.star`}`);
		console.error('build first: bun run build (output_path=auto installs it)');
		process.exit(1);
	}

	writeDevFire(plan.command);
	console.log(plan.message);
}
