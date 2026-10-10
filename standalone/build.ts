import { resolve } from 'node:path';
const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, 'browser.ts')],
    outdir: resolve(import.meta.dir, '../dist/standalone'),
    naming: 'frontend.js', target: 'browser', format: 'iife',
    plugins: [{ name: 'standalone-host', setup(build) {
        build.onResolve({ filter: /^millennium$/ }, () => ({ path: resolve(import.meta.dir, 'adapter.ts') }));
    } }],
});
if (!result.success) { for (const log of result.logs) console.error(log); process.exit(1); }
console.log(`Standalone frontend: ${result.outputs[0]?.path}`);
