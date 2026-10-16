// Common host selection keeps the existing numeric capture form.
import { main as millenniumCapture } from './capture-millennium';
import { selectHost, capture } from '../host-client';
import { parseCommonOptions } from '../cli-options';
export async function main(entry: string): Promise<void> {
    try { const options = parseCommonOptions(process.argv.slice(2)); if (options.args.length > 1) throw new Error('usage: tools/capture [n] [--host auto|millennium|standalone] [--json]'); const count = options.args.length ? Number(options.args[0]) : 8; const host = await selectHost(options.host); if (host === 'millennium' && !options.json) { await millenniumCapture(entry, count); } else console.log(JSON.stringify(await capture(count, host), null, options.json ? undefined : 2)); }
    catch (e: any) { console.error(e.message); process.exitCode = 1; }
}
