import { resolve } from 'node:path';
// Embed the browser-only bundle through the CLI's text import.
const editor = await Bun.build({ entrypoints: [resolve(import.meta.dir, 'settings-browser.ts')], target: 'browser', format: 'iife' });
if (!editor.success) { for (const log of editor.logs) console.error(log); process.exit(1); }
await Bun.write(resolve(import.meta.dir, '../dist/build/settings.txt'), await editor.outputs[0]!.text());
