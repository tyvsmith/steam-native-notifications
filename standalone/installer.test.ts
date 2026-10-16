import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile,readlink,rm,lstat,symlink,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {setupPaths} from './paths';import {installPackage as realInstallPackage,packagePaths,recover,packageCommand} from './installer';import {ASSETS,sha256,validateRelease} from './package-manifest';import {install as sourceInstall} from './setup';
async function fixture(){const home=await mkdtemp(join(tmpdir(),'snn package spaces '));const p=setupPaths({},home);const steam=join(home,'Steam root');await mkdir(join(steam,'steamrt64'),{recursive:true});await writeFile(join(steam,'steam.sh'),'');await writeFile(join(steam,'steamrt64/steam'),'');let serial=0;async function release(){const id=(++serial).toString(16).padStart(64,'0');const root=join(home,`release ${serial}`);const files:Record<string,string>={};for(const rel of ASSETS){await mkdir(join(root,rel,'..'),{recursive:true});const text=rel==='dist/standalone/build.json'?JSON.stringify({version:'0.1.0',buildId:id,protocolVersion:1}):rel;await writeFile(join(root,rel),text,{mode:['snn','tools/notify-action'].includes(rel)?0o755:0o644});files[rel]=sha256(text);}await writeFile(join(root,'manifest.json'),JSON.stringify({format:1,version:'0.1.0',buildId:id,target:'linux-x64',bun:'1.4.3',glibc:'2.17',files}));return root;}return {home,p,steam,release};}
const run=async(args:string[])=>args[0]==='show'?'UnitFileState=enabled\nActiveState=active':'';
const installPackage: typeof realInstallPackage = (p,r,s,runner=run,verify=async()=>{}) => realInstallPackage(p,r,s,async args=>{const result=await runner(args);return args[0]==='show'&&!result?'UnitFileState=enabled\nActiveState=active':result;},verify);
test('clean install, upgrade and rollback preserve bytes, marker and physical versions',async()=>{const f=await fixture();try{const r1=await f.release(),r2=await f.release();await mkdir(join(f.p.config,'..'),{recursive:true});const config=' {"devFire":false,"unknown":42}\n';await writeFile(f.p.config,config);await writeFile(join(f.steam,'.cef-enable-remote-debugging'),'preexisting');const a=await installPackage(f.p,r1,f.steam,run);expect(a.files.find(r=>r.path.endsWith('.cef-enable-remote-debugging'))?.owned).toBe(false);const b=await installPackage(f.p,r2,undefined,run);expect(b.previous).toBe(a.active);const c=await installPackage(f.p,b.previous!,undefined,run);expect(c.active).toBe(a.active);expect(await readFile(f.p.config,'utf8')).toBe(config);expect(await readFile(join(f.steam,'.cef-enable-remote-debugging'),'utf8')).toBe('preexisting');expect(await readlink(packagePaths(f.p).active)).toBe(a.active);expect(await readFile(packagePaths(f.p).desktop,'utf8')).toContain('settings');}finally{await rm(f.home,{recursive:true,force:true});}});
test('source migration retains ownership, unknown preferences and refuses altered journal/files',async()=>{const f=await fixture();try{const source=join(f.home,'source');for(const rel of [...ASSETS.filter(x=>x!=='snn'&&x!=='LICENSE'),'standalone/daemon.ts']){await mkdir(join(source,rel,'..'),{recursive:true});await writeFile(join(source,rel),'');}await writeFile(join(f.steam,'.cef-enable-remote-debugging'),'');await sourceInstall(f.p,source,'/fake/bun',f.steam);await writeFile(f.p.config,'{"unknown":"retain","devFire":true}\n');const bytes=await readFile(f.p.config);const old=await readFile(f.p.unit,'utf8');await writeFile(f.p.unit,'modified');await expect(installPackage(f.p,await f.release(),undefined,run)).rejects.toThrow('Modified/unowned');await writeFile(f.p.unit,old);const state=JSON.parse(await readFile(f.p.state,'utf8'));const stat=await lstat(f.p.unit);Object.assign(state.files.find((r:any)=>r.path===f.p.unit),{dev:stat.dev,ino:stat.ino,hash:sha256(old)});await writeFile(f.p.state,JSON.stringify(state));const next=await installPackage(f.p,await f.release(),undefined,run);expect(next.version).toBe(2);expect(await readFile(f.p.config)).toEqual(bytes);expect(next.files.find(r=>r.path.endsWith('.cef-enable-remote-debugging'))?.owned).toBe(false);}finally{await rm(f.home,{recursive:true,force:true});}});
test('failed service restart restores prior active and fresh ownership; later upgrade succeeds',async()=>{const f=await fixture();try{const a=await installPackage(f.p,await f.release(),f.steam,run);const old=await readFile(f.p.unit,'utf8');let failed=false;await expect(installPackage(f.p,await f.release(),undefined,async args=>{if(args[0]==='restart'&&!failed){failed=true;throw new Error('fixture restart failure');}return '';})).rejects.toThrow('fixture restart failure');expect(await readlink(packagePaths(f.p).active)).toBe(a.active);expect(await readFile(f.p.unit,'utf8')).toBe(old);await installPackage(f.p,await f.release(),undefined,run);expect(await recover(f.p,run)).toBe(false);}finally{await rm(f.home,{recursive:true,force:true});}});
test('checksums, foreign files, symlinks and modified installed assets fail before service operations',async()=>{const f=await fixture();try{const r=await f.release();await writeFile(join(r,'foreign'),'');await expect(validateRelease(r)).rejects.toThrow('Unexpected');await rm(join(r,'foreign'));await writeFile(join(r,'snn'),'corrupt');await expect(validateRelease(r)).rejects.toThrow('checksum');const a=await installPackage(f.p,await f.release(),f.steam,run);await writeFile(join(a.active,'tools/notify-action'),'modified');let calls=0;await expect(installPackage(f.p,await f.release(),undefined,async()=>{calls++;return '';})).rejects.toThrow('checksum');expect(calls).toBe(0);}finally{await rm(f.home,{recursive:true,force:true});}});
test('pending interrupted activation recovery is retryable; modified target is preserved',async()=>{const f=await fixture();try{await installPackage(f.p,await f.release(),f.steam,run);await expect(installPackage(f.p,await f.release(),undefined,async args=>{if(args[0]==='restart')throw new Error('restart unavailable');return '';})).rejects.toThrow('recovery pending');await writeFile(f.p.unit,'user changed during recovery');await expect(recover(f.p,run)).rejects.toThrow('Modified recovery target');expect(await readFile(f.p.unit,'utf8')).toBe('user changed during recovery');const tx=JSON.parse(await readFile(packagePaths(f.p).tx,'utf8'));const snap=tx.snapshots.find((s:any)=>s.path===f.p.unit);await writeFile(f.p.unit,Buffer.from(snap.value,'base64'));expect(await recover(f.p,run)).toBe(true);await installPackage(f.p,await f.release(),undefined,run);}finally{await rm(f.home,{recursive:true,force:true});}});
test('malformed duplicate and unowned v1 ownership refused without runner calls',async()=>{const f=await fixture();try{const source=join(f.home,'source');for(const rel of [...ASSETS.filter(x=>x!=='snn'&&x!=='LICENSE'),'standalone/daemon.ts']){await mkdir(join(source,rel,'..'),{recursive:true});await writeFile(join(source,rel),'');}await sourceInstall(f.p,source,'/fake/bun',f.steam);const original=JSON.parse(await readFile(f.p.state,'utf8'));for(const malformed of [{...original,files:[...original.files,original.files[0]]},{...original,files:original.files.map((r:any)=>r.path===f.p.unit?{...r,owned:false}:r)},{...original,paths:{...f.p,unit:'/tmp/foreign'}}]){await writeFile(f.p.state,JSON.stringify(malformed));let calls=0;await expect(installPackage(f.p,await f.release(),undefined,async()=>{calls++;return '';})).rejects.toThrow();expect(calls).toBe(0);}}finally{await rm(f.home,{recursive:true,force:true});}});

test('every managed switch prefix recovers previous installation after interruption',async()=>{for(let prefix=0;prefix<=6;prefix++){const f=await fixture();try{const old=await installPackage(f.p,await f.release(),f.steam,run);const q=packagePaths(f.p);const targets=[f.p.unit,f.p.autostart,q.desktop,q.active,q.bin,f.p.state];const replacements:any[]=[];let captured=false;await expect(installPackage(f.p,await f.release(),undefined,async args=>{if(args[0]==='daemon-reload'){if(!captured){captured=true;for(const path of targets){const stat=await lstat(path);replacements.push({path,link:stat.isSymbolicLink(),value:stat.isSymbolicLink()?await readlink(path):await readFile(path)});}}throw new Error('interruption fixture');}return '';})).rejects.toThrow('recovery pending');for(const r of replacements.slice(0,prefix)){if(r.link){await unlink(r.path);await symlink(r.value,r.path);}else await writeFile(r.path,r.value);}expect(await recover(f.p,run)).toBe(true);expect(await readlink(q.active)).toBe(old.active);await installPackage(f.p,await f.release(),undefined,run);}finally{await rm(f.home,{recursive:true,force:true});}}});

test('uninstall refuses changed unit, desktop, links and unowned assets before service calls; preserves settings and marker',async()=>{const f=await fixture();try{const state=await installPackage(f.p,await f.release(),f.steam,run);const q=packagePaths(f.p);const targets=[f.p.unit,f.p.autostart,q.desktop,join(state.active,'tools/notify-action')];for(const path of targets){const bytes=await readFile(path);await writeFile(path,'modified');let calls=0;await expect(packageCommand('uninstall',[],f.p,async()=>{calls++;return '';})).rejects.toThrow();expect(calls).toBe(0);await writeFile(path,bytes);}await writeFile(join(state.active,'foreign'),'unowned');await expect(packageCommand('uninstall',[],f.p,run)).rejects.toThrow('Unexpected');await unlink(join(state.active,'foreign'));await unlink(q.bin);await symlink('/foreign/snn',q.bin);await expect(packageCommand('uninstall',[],f.p,run)).rejects.toThrow('Modified/unowned link');await unlink(q.bin);await symlink(join(q.active,'snn'),q.bin);const bytes=' {"unknown":true,"devFire":true}\n';await writeFile(f.p.config,bytes);await packageCommand('uninstall',[],f.p,run);expect(await readFile(f.p.config,'utf8')).toBe(bytes);expect(await readFile(join(f.steam,'.cef-enable-remote-debugging'),'utf8')).toBe('');}finally{await rm(f.home,{recursive:true,force:true});}});

async function pendingRecovery(f:Awaited<ReturnType<typeof fixture>>, fresh=false) {
    const old=fresh?undefined:await installPackage(f.p,await f.release(),f.steam,run);
    await expect(installPackage(f.p,await f.release(),f.steam,async args=>{
        if(args[0]==='restart'||(fresh&&args[0]==='disable'))throw new Error('fixture manager unavailable'); return '';
    })).rejects.toThrow('recovery pending');
    return old;
}
test('fresh install failure disables while unit exists and repeated extracted recovery converges',async()=>{
    const f=await fixture();try{
        let disabled=0;
        const strict=async(args:string[])=>{if(args[0]==='restart')throw new Error('activation failed');if(args[0]==='disable'){expect((await lstat(f.p.unit)).isFile()).toBe(true);disabled++;}return '';};
        await expect(installPackage(f.p,await f.release(),f.steam,strict)).rejects.toThrow('activation failed');
        expect(disabled).toBe(1);expect(await recover(f.p,run)).toBe(false);
        await pendingRecovery(f,true);
        let interrupted=false;await expect(recover(f.p,async args=>{if(args[0]==='disable'&&!await Bun.file(f.p.unit).exists())throw new Error('Unit does not exist');return '';},async step=>{if(step==='recovery-manager-journaled'&&!interrupted){interrupted=true;throw new Error('crash after stop journal');}})).rejects.toThrow('crash after stop journal');
        expect(await packageCommand('recover',[],f.p,run)).toEqual({recovered:true});
        expect(await recover(f.p,run)).toBe(false);await installPackage(f.p,await f.release(),f.steam,run);
    }finally{await rm(f.home,{recursive:true,force:true});}
});
test('every recovery durable boundary including refreshed publication and partial/finished cleanup is retryable',async()=>{
    for(const fresh of [false,true]) {
        let boundaries=0;const baseline=await fixture();try{await pendingRecovery(baseline,fresh);await recover(baseline.p,run,async()=>{boundaries++;});}finally{await rm(baseline.home,{recursive:true,force:true});}
        for(let stop=1;stop<=boundaries;stop++) {
            const f=await fixture();try{const old=await pendingRecovery(f,fresh);let step=0;
                await expect(recover(f.p,run,async()=>{if(++step===stop)throw new Error('injected recovery interruption');})).rejects.toThrow('injected recovery interruption');
                expect(await recover(f.p,run)).toBe(true);expect(await recover(f.p,run)).toBe(false);
                if(old)expect(await readlink(packagePaths(f.p).active)).toBe(old.active);
                await installPackage(f.p,await f.release(),f.steam,run);
            }finally{await rm(f.home,{recursive:true,force:true});}
        }
    }
});
test('every uninstall durable boundary including partial file/directory cleanup resumes via recover or uninstall',async()=>{
    let boundaries=0;const baseline=await fixture();try{await installPackage(baseline.p,await baseline.release(),baseline.steam,run);await packageCommand('uninstall',[],baseline.p,run,async()=>{boundaries++;});}finally{await rm(baseline.home,{recursive:true,force:true});}
    for(let stop=1;stop<=boundaries;stop++) {
        const f=await fixture();try{await installPackage(f.p,await f.release(),f.steam,run);const config=' {"unknown":"preserve","devFire":true}\n';await writeFile(f.p.config,config);let step=0;
            await expect(packageCommand('uninstall',[],f.p,run,async()=>{if(++step===stop)throw new Error('injected uninstall interruption');})).rejects.toThrow('injected uninstall interruption');
            if(stop%2)await packageCommand('uninstall',[],f.p,run);else expect(await recover(f.p,run)).toBe(true);
            expect(await recover(f.p,run)).toBe(false);expect(await readFile(f.p.config,'utf8')).toBe(config);expect(await readFile(join(f.steam,'.cef-enable-remote-debugging'),'utf8')).toBe('');
            await installPackage(f.p,await f.release(),f.steam,run);
        }finally{await rm(f.home,{recursive:true,force:true});}
    }
});
test('pending cleanup preserves modified and foreign assets and refuses before unlinking owned files',async()=>{
    const f=await fixture();try{await installPackage(f.p,await f.release(),f.steam,run);await expect(packageCommand('uninstall',[],f.p,run,async step=>{if(step==='uninstall-journaled')throw new Error('pause cleanup');})).rejects.toThrow('pause cleanup');const t=JSON.parse(await readFile(packagePaths(f.p).tx,'utf8'));const root=t.releases[0];await writeFile(join(root,'foreign'),'preserve');await expect(recover(f.p,run)).rejects.toThrow('Unowned cleanup');expect(await readFile(join(root,'foreign'),'utf8')).toBe('preserve');await unlink(join(root,'foreign'));const path=join(root,'tools/notify-action');await writeFile(path,'modified');await expect(recover(f.p,run)).rejects.toThrow('Modified cleanup');expect(await readFile(path,'utf8')).toBe('modified');expect((await lstat(f.p.unit)).isFile()).toBe(true);}finally{await rm(f.home,{recursive:true,force:true});}
});
test('inactive disabled upgrades stage without activation; failed readiness restores prior enabled and active state',async()=>{
 const f=await fixture();try{
 const a=await installPackage(f.p,await f.release(),f.steam,run);const calls:string[][]=[];
 await installPackage(f.p,await f.release(),undefined,async args=>{calls.push(args);return args[0]==='show'?'UnitFileState=disabled\nActiveState=inactive':'';},async()=>{throw Error('must not activate');});
 expect(calls.some(a=>['enable','restart','start'].includes(a[0]!))).toBe(false);
 const old=await readlink(packagePaths(f.p).active);
 await expect(installPackage(f.p,await f.release(),undefined,async args=>{calls.push(args);return args[0]==='show'?'UnitFileState=disabled\nActiveState=active':'';},async()=>{throw Error('wrong daemon');})).rejects.toThrow('wrong daemon');
 expect(await readlink(packagePaths(f.p).active)).toBe(old);expect(calls.some(a=>a[0]==='disable')).toBe(true);
 expect(old).not.toBe(a.active);
 // Uninstall must work after Steam itself was removed.
 await rm(f.steam,{recursive:true});await packageCommand('uninstall',[],f.p,run);
 }finally{await rm(f.home,{recursive:true,force:true});}
});
test('all enabled/active combinations survive upgrade unchanged',async()=>{
 for(const enabled of [false,true])for(const active of [false,true]){
  const f=await fixture();try{
   await installPackage(f.p,await f.release(),f.steam,run);const calls:string[][]=[];let verified=false;
   const result=await installPackage(f.p,await f.release(),undefined,async args=>{calls.push(args);return args[0]==='show'?`UnitFileState=${enabled?'enabled':'disabled'}\nActiveState=${active?'active':'inactive'}`:'';},async()=>{verified=true;});
   expect(verified).toBe(active);expect(calls.some(a=>a[0]==='restart')).toBe(active);
   expect(calls.some(a=>['enable','disable'].includes(a[0]!))).toBe(false);
   expect(result.activation).toContain(active?'verified':'staged');
  }finally{await rm(f.home,{recursive:true,force:true});}
 }
});
test('release executable mode and protocol failures precede managed mutations',async()=>{
 const {chmod}=await import('node:fs/promises');const f=await fixture();try{
  const r=await f.release();await chmod(join(r,'snn'),0o644);await expect(validateRelease(r)).rejects.toThrow('executable');
  await chmod(join(r,'snn'),0o755);const path=join(r,'dist/standalone/build.json');const identity=JSON.parse(await readFile(path,'utf8'));identity.protocolVersion=99;await writeFile(path,JSON.stringify(identity));
  const m=JSON.parse(await readFile(join(r,'manifest.json'),'utf8'));m.files['dist/standalone/build.json']=sha256(await readFile(path));await writeFile(join(r,'manifest.json'),JSON.stringify(m));
  await expect(validateRelease(r)).rejects.toThrow('identity');
 }finally{await rm(f.home,{recursive:true,force:true});}
});
