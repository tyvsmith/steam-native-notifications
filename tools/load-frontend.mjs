/** Load the Millennium-free frontend subgraph through Bun's TypeScript loader. */
import { createRequire } from 'node:module';

const load = createRequire(import.meta.url);

/** Names are frontend paths without .ts, including generated/notifications. */
export function loadFrontendModules(names) {
    if (typeof Bun === 'undefined') throw new Error('Run frontend tools with Bun');
    return Object.fromEntries(names.map(name => [name, load(`../frontend/${name}.ts`)]));
}
