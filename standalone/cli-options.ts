import type { HostSelection } from './client';
export function parseCommonOptions(argv: string[]) {
    let host: HostSelection = 'auto'; let hostExplicit = false; let json = false;
    const args: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--host') {
            const value = argv[++i];
            if (!['auto', 'standalone', 'millennium'].includes(value ?? '')) throw new Error('--host must be auto, standalone or millennium');
            host = value as HostSelection; hostExplicit = true;
        } else if (argv[i] === '--json') json = true;
        else args.push(argv[i]!);
    }
    return { host, hostExplicit, json, args };
}
export function printResult(value: unknown, json: boolean): void {
    if (json) { console.log(JSON.stringify(value)); return; }
    const render = (item: any, depth = 0): string => {
        if (item === null || typeof item !== 'object') return String(item);
        if (Array.isArray(item)) return item.map(v => render(v, depth)).join('\n');
        return Object.entries(item).map(([key, v]) => `${'  '.repeat(depth)}${key}: ${v !== null && typeof v === 'object' ? '\n' + render(v, depth + 1) : String(v)}`).join('\n');
    };
    console.log(render(value));
}
export function printError(error: unknown, json: boolean): void {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ ok: false, error: message }));
    else console.error(message);
    process.exitCode = 1;
}
