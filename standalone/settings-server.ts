import { preferencePatch, preferenceDefaults } from '../shared/settings-policy';
import { BUILD_IDENTITY } from '../shared/host';
import { SETTINGS_SCHEMA } from '../shared/settings';
import { type ConfigStore } from './config-store';
import { hostStatus, sample, readConfig, updateConfig, type HostSelection } from '../tools/lib/host-client';
import { settingsHtml, settingsScript, settingsStyle } from './settings-assets';
export interface SettingsServerOptions { store?: ConfigStore; host?: HostSelection; status?: typeof hostStatus; sample?: typeof sample; idleMs?: number }
/** Per-command capability session; no daemon/config lock is held by its lifetime. */
export function startSettingsServer(options: SettingsServerOptions = {}) {
    const store = options.store ?? { read: () => readConfig('standalone'), update: (patch: unknown) => updateConfig(patch, 'standalone') }; const host = options.host === 'millennium' ? 'millennium' : 'standalone';
    if (host === 'millennium') throw new Error('This independent settings page configures standalone; use Millennium’s panel for Millennium');
    const token = crypto.randomUUID() + crypto.randomUUID(); let idle: ReturnType<typeof setTimeout>; let resolveClosed!: () => void;
    const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
    const stop = () => { clearTimeout(idle); server.stop(true); resolveClosed(); };
    const touch = () => { clearTimeout(idle); idle = setTimeout(stop, options.idleMs ?? 30 * 60 * 1000); };
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, maxRequestBodySize: 8192, async fetch(request) {
        const url = new URL(request.url); const origin = `http://127.0.0.1:${server.port}`;
        if (request.headers.get('host') !== `127.0.0.1:${server.port}` || (request.headers.has('origin') && request.headers.get('origin') !== origin)) return json({ error: 'Untrusted host or origin' }, 403);
        if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method unavailable' }, 405);
        if (url.search) return json({ error: 'Query parameters unavailable' }, 400);
        const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" };
        if (request.method === 'GET' && ['/','/settings.js','/settings.css'].includes(url.pathname)) return new Response(url.pathname === '/' ? settingsHtml : url.pathname.endsWith('.js') ? settingsScript : settingsStyle, { headers: { ...headers, 'Content-Type': url.pathname === '/' ? 'text/html; charset=utf-8' : url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' } });
        if (request.headers.get('authorization') !== `Bearer ${token}`) return json({ error: 'Unauthorized' }, 401);
        try {
            if (request.method === 'GET' && url.pathname === '/api/state') return json({ config: await store.read(), schema: SETTINGS_SCHEMA, platform: 'linux', build: BUILD_IDENTITY, hosts: await (options.status ?? hostStatus)(), session: 'Closes after 30 minutes without a settings change, reset, or sample request; Close settings or Ctrl+C also exits.' });
            if (request.method !== 'POST') return json({ error: 'Unknown endpoint' }, 404);
            if (request.headers.get('content-type') !== 'application/json') return json({ error: 'Expected application/json' }, 415);
            const body = await request.text(); if (body.length > 8192) return json({ error: 'Request too large' }, 413);
            let input: any; try { input = JSON.parse(body); } catch { return json({ error: 'Malformed JSON' }, 400); }
            if (url.pathname === '/api/config') {
                const patch = preferencePatch(input, (await store.read()).values, 'linux');
                touch(); return json(await store.update(patch));
            }
            if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) return json({ error: 'Expected empty object' }, 400);
            if (url.pathname === '/api/reset') { touch(); return json(await store.update(preferenceDefaults('linux'))); }
            if (url.pathname === '/api/sample') { touch(); return json(await (options.sample ?? sample)('standalone')); }
            if (url.pathname === '/api/close') { setTimeout(stop, 50); return json({ closed: true }); }
            return json({ error: 'Unknown endpoint' }, 404);
        } catch (error) { return json({ error: error instanceof Error ? error.message : 'Operation unavailable' }, 400); }
    } });
    touch(); return { url: `http://127.0.0.1:${server.port}/#${token}`, origin: `http://127.0.0.1:${server.port}`, stop, closed };
}
export async function settingsCommand(noOpen = false, host: HostSelection = 'standalone', jsonOutput = false): Promise<void> {
    const session = startSettingsServer({ host });
    if (jsonOutput) console.log(JSON.stringify({ host: 'standalone', url: session.url }));
    else { console.log('Standalone settings (saved even while Steam is stopped).'); console.log(session.url); console.log('Settings server: Ctrl+C to exit; closes after 30 minutes idle.'); }
    if (!noOpen) { try { const child = Bun.spawn(['xdg-open', session.url], { stdout: 'ignore', stderr: 'ignore' }); if (await child.exited !== 0) console.error('Browser launch failed. Open the local URL above.'); } catch { console.error('Browser launch failed. Open the local URL above.'); } }
    const close = () => session.stop(); process.once('SIGINT', close); process.once('SIGTERM', close);
    await session.closed; process.removeListener('SIGINT', close); process.removeListener('SIGTERM', close);
}
