/** Coordinator browser fixture. Explicit temporary path; never uses live settings/control. */
import { resolve } from 'node:path';
import { ConfigStore } from './config-store';
import { startSettingsServer } from './settings-server';
const path = process.argv[2]; if (!path || !resolve(path).startsWith('/tmp/')) throw new Error('Supply a /tmp/ fixture config path');
const mode = process.argv[3] ?? 'offline';
const session = startSettingsServer({ store:new ConfigStore(path), status:async()=>[{host:'standalone',present:mode==='ready',state:mode==='ready'?'ready':'unavailable',action:mode==='stale'?'Frontend build mismatch; fully restart Steam.':undefined}],sample:async()=>{ if(mode!=='ready') throw Error('No ready standalone host');return {host:'standalone',stage:'executed',message:'Browser fixture only; no real notification delivered.'};} });
console.log(session.url); process.once('SIGINT',session.stop);process.once('SIGTERM',session.stop);await session.closed;
