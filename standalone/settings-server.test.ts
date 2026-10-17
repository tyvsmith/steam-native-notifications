import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from './config-store';
import { startSettingsServer } from './settings-server';
async function fixture(run: (s: ReturnType<typeof startSettingsServer>, call: (path: string, body?: unknown, headers?: Record<string,string>, method?: string) => Promise<Response>, root: string) => Promise<void>) {
    const root = await mkdtemp(join(tmpdir(), 'snn-settings-')); const store = new ConfigStore(join(root, 'config.json')); let samples = 0;
    const s = startSettingsServer({ store, status: async () => [{ host: 'standalone', present: false, state: 'unavailable' }], sample: async () => ({ stage: 'executed', count: ++samples }) });
    const call = (path: string, body?: unknown, headers?: Record<string,string>, method?: string) => fetch(s.origin + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { authorization: 'Bearer '+new URL(s.url).hash.slice(1), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    try { await run(s, call, root); } finally { s.stop(); await rm(root, { recursive:true, force:true }); }
}
test('loopback API rejects unauthorized, origins, hosts, methods and invalid shapes', async () => fixture(async (s, call) => {
    expect((await fetch(s.origin+'/api/state')).status).toBe(401);
    expect((await call('/api/state', undefined, { origin:'https://evil.example' })).status).toBe(403);
    expect((await call('/api/state', undefined, { host:'localhost:'+new URL(s.url).port })).status).toBe(403);
    expect((await call('/api/state', undefined, {}, 'DELETE')).status).toBe(405);
    expect((await call('/api/config', { notifyOutsideGame:'yes' })).status).toBe(400);
    expect((await call('/api/config', { devMode:true })).status).toBe(400);
    expect((await call('/api/config', { devFire:true })).status).toBe(400);
    expect((await call('/api/config', { notificationCenterOnlyInGame:true })).status).toBe(400);
    expect((await call('/api/sample', 1)).status).toBe(400);
    expect((await call('/api/sample', {} , { 'content-type':'text/plain' })).status).toBe(415);
    expect((await call('/api/state?token=anything')).status).toBe(400);
    const malformed = await fetch(s.origin+'/api/config', { method:'POST', headers:{ authorization:'Bearer '+new URL(s.url).hash.slice(1), 'content-type':'application/json'}, body:'{' }); expect(malformed.status).toBe(400);
    const huge = await fetch(s.origin+'/api/config', { method:'POST', headers:{ authorization:'Bearer '+new URL(s.url).hash.slice(1), 'content-type':'application/json'}, body:JSON.stringify({ x:'a'.repeat(9000) }) }); expect(huge.status).toBe(413);
}));
test('offline edits/reset preserve unrelated and unsupported preferences, retain last valid, safe fixed sample and close', async () => fixture(async (s, call, root) => {
    await writeFile(join(root,'config.json'), JSON.stringify({ unrelated:'keep', notificationCenterOnlyInGame:true, devMode:true }));
    const state = await (await call('/api/state')).json(); expect(state.hosts[0].present).toBe(false); expect(state.build.version).toBeTruthy();
    expect((await call('/api/config',{ notifyOutsideGame:false, devFire:true })).status).toBe(200);
    const persisted = JSON.parse(await readFile(join(root,'config.json'),'utf8')); expect(persisted.unrelated).toBe('keep'); expect(persisted.devFire).toBe(true);
    expect((await call('/api/reset',{})).status).toBe(200);
    const reset = JSON.parse(await readFile(join(root,'config.json'),'utf8')); expect(reset.notificationCenterOnlyInGame).toBe(true); expect(reset.devMode).toBe(true); expect(reset.notifyOutsideGame).toBe(true);
    await writeFile(join(root,'config.json'),'{bad'); const invalid = await (await call('/api/state')).json(); expect(invalid.config.error).toContain('Invalid'); expect(invalid.config.values.notifyOutsideGame).toBe(true); expect((await call('/api/config',{notifyOutsideGame:false})).status).toBe(400);
    expect((await (await call('/api/sample',{})).json()).stage).toBe('executed');
    expect((await call('/api/sample',{command:'eval'})).status).toBe(400);
    expect((await call('/api/close',{})).status).toBe(200); await s.closed; await expect(fetch(s.origin)).rejects.toThrow();
}));
test('idle session closes and bundled assets have strict CSP', async () => {
    const s = startSettingsServer({idleMs:40}); const response=await fetch(s.origin); expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'"); expect(await response.text()).toContain('Notification settings'); await s.closed;
});
test('UI writes propagate to actual standalone Host settings', async () => fixture(async (_s, call, root) => {
    const { Host } = await import('./host'); const host = new Host(join(root,'cache'),join(root,'config.json'),root); await host.initialize();
    expect((await host.settings()).notifyOutsideGame).toBe(true);
    await call('/api/config',{notifyOutsideGame:false}); expect((await host.settings()).notifyOutsideGame).toBe(false);
    await call('/api/config',{showSteamInGame:false}); expect((await host.settings()).showSteamInGame).toBe(false);
}));

test('older or unavailable frontend rejects sample with clear failure', async () => {
 const s=startSettingsServer({sample:async()=>{throw Error('Frontend build mismatch; fully restart Steam.')}});
 try {const r=await fetch(s.origin+'/api/sample',{method:'POST',headers:{authorization:'Bearer '+new URL(s.url).hash.slice(1),'content-type':'application/json'},body:'{}'});expect(r.status).toBe(400);expect((await r.json()).error).toContain('restart Steam');}finally{s.stop();}
});

test('authenticated passive state polls do not extend idle lease', async () => {
 const s=startSettingsServer({idleMs:100,status:async()=>[],store:new ConfigStore(join(tmpdir(),'snn-idle-'+crypto.randomUUID()+'.json'))});
 const authorization='Bearer '+new URL(s.url).hash.slice(1);let polls=0;
 const timer=setInterval(()=>{void fetch(s.origin+'/api/state',{headers:{authorization}}).then(()=>{polls++;}).catch(()=>{});},10);
 try {await Promise.race([s.closed,Bun.sleep(500).then(()=>{throw Error('Polling extended idle session');})]);expect(polls).toBeGreaterThan(2);}finally{clearInterval(timer);s.stop();}
});
test('valid user settings action renews idle lease', async () => {
 const root=await mkdtemp(join(tmpdir(),'snn-activity-'));const s=startSettingsServer({idleMs:180,status:async()=>[],store:new ConfigStore(join(root,'config.json'))});let closed=false;s.closed.then(()=>{closed=true;});
 try {await Bun.sleep(100);const r=await fetch(s.origin+'/api/config',{method:'POST',headers:{authorization:'Bearer '+new URL(s.url).hash.slice(1),'content-type':'application/json'},body:'{"notifyOutsideGame":false}'});expect(r.status).toBe(200);await Bun.sleep(110);expect(closed).toBe(false);await s.closed;}finally{s.stop();await rm(root,{recursive:true,force:true});}
});

test('default editor uses daemon custom config and never retries a failed mutation offline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snn-editor-target-'));
    const program = `
        import { Host } from ${JSON.stringify(join(import.meta.dir, 'host.ts'))};
        import { startControl } from ${JSON.stringify(join(import.meta.dir, 'control.ts'))};
        import { controlHandler } from ${JSON.stringify(join(import.meta.dir, 'control-host.ts'))};
        import { startSettingsServer } from ${JSON.stringify(join(import.meta.dir, 'settings-server.ts'))};
        const host = new Host(${JSON.stringify(join(root, 'cache'))}, ${JSON.stringify(join(root, 'custom.json'))}, ${JSON.stringify(root)});
        await host.initialize();
        await host.store.update({ notifyInGame: false, devMode: true });
        const handler = controlHandler(host);
        const stop = await startControl(async request => {
            const reply = await handler(request);
            // Simulate a reply lost after the requested write committed.
            if (request.operation === 'config.update' && request.payload.showSteamInGame === false) throw Error('reply lost after commit');
            return reply;
        });
        const session = startSettingsServer();
        console.log(session.url);
        await session.closed; await stop(); host.stop();
    `;
    const child = Bun.spawn([process.execPath, '-e', program], { env: { ...process.env, XDG_RUNTIME_DIR: root, XDG_CONFIG_HOME: join(root, 'default') }, stdout: 'pipe', stderr: 'pipe' });
    try {
        const reader = child.stdout.getReader(); const first = await reader.read();
        const url = new TextDecoder().decode(first.value).trim(); reader.releaseLock();
        const parsed = new URL(url);
        const call = (path: string, body?: unknown) => fetch(parsed.origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + parsed.hash.slice(1), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        expect((await (await call('/api/state')).json()).config.values.notifyInGame).toBe(false);
        expect((await call('/api/config', { notifyOutsideGame: false, devFire: true })).status).toBe(200);
        expect(JSON.parse(await readFile(join(root, 'custom.json'), 'utf8')).notifyOutsideGame).toBe(false);
        expect((await call('/api/config', { showSteamInGame: false })).status).toBe(400);
        expect(JSON.parse(await readFile(join(root, 'custom.json'), 'utf8')).showSteamInGame).toBe(false);
        expect(await Bun.file(join(root, 'default/steam-native-notifications/standalone.json')).exists()).toBe(false);
        expect((await call('/api/reset', {})).status).toBe(200);
        const reset = JSON.parse(await readFile(join(root, 'custom.json'), 'utf8'));
        expect(reset.notifyInGame).toBe(true); expect(reset.devMode).toBe(true);
        await call('/api/close', {}); expect(await child.exited).toBe(0);
    } finally { child.kill(); await child.exited; await rm(root, { recursive: true, force: true }); }
}, 15000);
