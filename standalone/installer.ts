import { serviceState, restoreService, waitForService, type Readiness } from './service-lifecycle';
import { mkdir, readFile, writeFile, lstat, readlink, symlink, rename, unlink, rm, cp, readdir, rmdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { setupPaths, discoverSteam, exists, UNIT, type Paths } from './paths';
import { desktopQuote, systemdQuote, systemctl, importSession, type Runner, type FileRecord } from './setup';
import { validateRelease, sha256, inventory } from './package-manifest';
import { CONFIG_DEFAULTS } from './host';
export function packagePaths(p: Paths) { const root=join(p.dataHome,'steam-native-notifications'); return {root, versions:join(root,'versions'), active:join(root,'active'), bin:join(p.home,'.local/bin/snn'), desktop:join(p.dataHome,'applications/steam-native-notifications.desktop'), tx: `${p.state}.transaction`}; }
type State = {version:2; steam:string; paths:Paths; active:string; previous?:string; files:FileRecord[]; links:Record<string,string>; releases:string[]};
type Snapshot = {path:string; kind:'absent'|'file'|'link'; value?:string; mode?:number; dev?:number; ino?:number};
async function atomic(path:string,value:string) { await mkdir(dirname(path),{recursive:true,mode:0o700}); const tmp=`${path}.tmp-${process.pid}`; await writeFile(tmp,value,{flag:'wx',mode:0o600}); await rename(tmp,path); }
async function record(path:string):Promise<FileRecord> { const s=await lstat(path); if (!s.isFile()) throw new Error(`Not regular: ${path}`); return {path,owned:true,dev:s.dev,ino:s.ino,hash:sha256(await readFile(path))}; }
async function unchanged(r:FileRecord) { try { const n=await record(r.path); return n.dev===r.dev&&n.ino===r.ino&&n.hash===r.hash; }catch{return false;} }
async function snapshot(path:string):Promise<Snapshot> { if(!await exists(path))return {path,kind:'absent'}; const s=await lstat(path); if(s.isSymbolicLink())return {path,kind:'link',value:await readlink(path)}; if(!s.isFile())throw new Error(`Unsafe transaction target: ${path}`);return {path,kind:'file',value:(await readFile(path)).toString('base64'),mode:s.mode&0o777}; }
async function link(path:string,target:string) { await mkdir(dirname(path),{recursive:true,mode:0o700});const tmp=`${path}.tmp-${process.pid}`;await symlink(target,tmp);await rename(tmp,path); }
async function restore(s:Snapshot) { if(s.kind==='absent'){if(await exists(s.path))await unlink(s.path);}else if(s.kind==='link')await link(s.path,s.value!);else {await mkdir(dirname(s.path),{recursive:true,mode:0o700});const tmp=`${s.path}.restore-${process.pid}`;await writeFile(tmp,Buffer.from(s.value!,'base64'),{flag:'wx',mode:s.mode});await rename(tmp,s.path);} }
async function load(p:Paths):Promise<any> { if(!await exists(p.state))return undefined;if(!(await lstat(p.state)).isFile())throw new Error('Unsafe state journal');return JSON.parse(await readFile(p.state,'utf8')); }
async function validateState(p:Paths,s:any) {
    const q=packagePaths(p);if(![1,2].includes(s.version)||!s.paths||JSON.stringify(s.paths)!==JSON.stringify(p)||typeof s.steam!=='string'||!s.steam.startsWith('/')||resolve(s.steam)!==s.steam||!Array.isArray(s.files))throw new Error('Malformed/mismatched install journal');
    const allowed=[p.config,p.unit,p.autostart,join(s.steam,'.cef-enable-remote-debugging'),...(s.version===2?[q.desktop]:[])];
    const seen=new Set();for(const r of s.files){if(!allowed.includes(r.path)||seen.has(r.path)||typeof r.owned!=='boolean'||(r.owned&&(!Number.isSafeInteger(r.dev)||!Number.isSafeInteger(r.ino)||!/^[a-f0-9]{64}$/.test(r.hash))))throw new Error('Invalid ownership record');seen.add(r.path);}
    for(const path of [p.unit,p.autostart,...(s.version===2?[q.desktop]:[])]){const r=s.files.find((r:FileRecord)=>r.path===path);if(!r?.owned||!await unchanged(r))throw new Error(`Modified/unowned managed file: ${path}`);}
    if(s.version===2){if(!Array.isArray(s.releases)||!s.releases.includes(s.active)||new Set(s.releases).size!==s.releases.length||s.releases.some((r:string)=>typeof r!=='string'||dirname(r)!==q.versions))throw new Error('Invalid release ownership');for(const r of s.releases)await validateRelease(r);if(s.links?.[q.active]!==s.active||s.links?.[q.bin]!==join(q.active,'snn')||Object.keys(s.links).length!==2)throw new Error('Invalid link journal');for(const [path,target]of Object.entries(s.links)){if(!(await lstat(path)).isSymbolicLink()||await readlink(path)!==target)throw new Error(`Modified/unowned link: ${path}`);}}
}
function unit(p:Paths,bin:string,steam:string){return `[Unit]\nDescription=Steam native notifications\nPartOf=graphical-session.target\nAfter=graphical-session-pre.target\n[Service]\nType=exec\nExecStart=${[bin,'daemon','--config',p.config,'--steam-dir',steam].map(x=>systemdQuote(x.replace(/\$/g,'$$$$'))).join(' ')}\nRestart=on-failure\nRestartSec=5\nUMask=0077\n`+['HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_STATE_HOME'].map((k,i)=>`Environment=${systemdQuote(`${k}=${[p.home,p.configHome,p.cacheHome,p.dataHome,p.stateHome][i]}`)}\n`).join('')+'[Install]\nWantedBy=graphical-session.target\n';}
/** Optional fixture observer runs after each durable boundary; never selected by CLI/environment. */
export type Checkpoint = (step: string) => Promise<void>;
const noCheckpoint: Checkpoint = async () => {};
type Removal = { files: FileRecord[]; directories: string[] };
async function removalPlan(roots: string[]): Promise<Removal> {
    const files: FileRecord[] = []; const directories = new Set<string>();
    for (const root of roots) {
        await validateRelease(root);
        for (const relative of await inventory(root)) {
            files.push(await record(join(root, relative)));
            let dir = dirname(join(root, relative));
            while (dir.startsWith(root + '/') || dir === root) { directories.add(dir); if (dir === root) break; dir = dirname(dir); }
        }
    }
    return { files, directories: [...directories].sort((a,b) => b.length-a.length) };
}
async function validateRemoval(plan: Removal, roots: string[]) {
    if (!plan || !Array.isArray(plan.files) || !Array.isArray(plan.directories) || new Set(plan.files.map(f=>f.path)).size!==plan.files.length) throw new Error('Invalid removal journal');
    for (const file of plan.files) if (resolve(file.path)!==file.path || !roots.some(root => file.path.startsWith(root+'/')) || !/^[a-f0-9]{64}$/.test(file.hash ?? '')) throw new Error('Unsafe removal file');
    for (const dir of plan.directories) if (resolve(dir)!==dir || !roots.some(root => dir===root || dir.startsWith(root+'/'))) throw new Error('Unsafe removal directory');
    const allowed = new Set([...plan.files.map(f=>f.path), ...plan.directories]);
    async function visit(dir: string) {
        if (!await exists(dir)) return;
        if (!(await lstat(dir)).isDirectory()) throw new Error(`Modified cleanup directory: ${dir}`);
        for (const name of await readdir(dir)) {
            const path = join(dir,name); if (!allowed.has(path)) throw new Error(`Unowned cleanup asset preserved: ${path}`);
            const stat = await lstat(path);
            if (stat.isDirectory()) await visit(path);
            else { const file=plan.files.find(f=>f.path===path); if (!file || !await unchanged(file)) throw new Error(`Modified cleanup asset preserved: ${path}`); }
        }
    }
    for (const root of roots) await visit(root);
}
async function removePlanned(plan: Removal, roots: string[], checkpoint: Checkpoint) {
    await validateRemoval(plan, roots);
    for (const file of plan.files) if (await exists(file.path)) {
        if (!await unchanged(file)) throw new Error(`Modified cleanup asset preserved: ${file.path}`);
        await unlink(file.path); await checkpoint(`remove-file:${file.path}`);
    }
    for (const dir of plan.directories) if (await exists(dir)) { await rmdir(dir); await checkpoint(`remove-directory:${dir}`); }
}
async function finishUninstall(p: Paths, t: any, run: Runner, checkpoint: Checkpoint) {
    const q=packagePaths(p); const paths=[p.unit,p.autostart,q.desktop,q.bin,q.active,p.state];
    if (t.kind!=='uninstall' || !Array.isArray(t.snapshots) || t.snapshots.length!==paths.length || t.snapshots.some((s:Snapshot,i:number)=>s.path!==paths[i]||!['file','link'].includes(s.kind)) || !Array.isArray(t.releases) || t.releases.some((r:string)=>typeof r!=='string'||dirname(r)!==q.versions)) throw new Error('Invalid uninstall transaction');
    for (const snap of t.snapshots as Snapshot[]) if (await exists(snap.path)) {
        const now=await snapshot(snap.path); const stat=await lstat(snap.path); if(now.kind!==snap.kind||now.value!==snap.value||stat.dev!==snap.dev||stat.ino!==snap.ino) throw new Error(`Modified uninstall target preserved: ${snap.path}`);
    }
    await validateRemoval(t.removal,t.releases);
    if (!t.managerStopped) {
        if (!await exists(p.unit)) throw new Error('Unit removed before service cleanup; refusing uncertain manager state');
        await run(['disable','--now',UNIT]); await checkpoint('uninstall-manager-disabled');
        t.managerStopped=true; await atomic(q.tx,JSON.stringify(t)); await checkpoint('uninstall-manager-journaled');
    }
    for (const snap of t.snapshots as Snapshot[]) if (await exists(snap.path)) { await unlink(snap.path); await checkpoint(`uninstall-unlink:${snap.path}`); }
    await removePlanned(t.removal,t.releases,checkpoint);
    await run(['daemon-reload']); await checkpoint('uninstall-reloaded');
    await unlink(q.tx); return true;
}
export async function recover(p:Paths,run:Runner,checkpoint:Checkpoint=noCheckpoint) {
    const q=packagePaths(p); if(!await exists(q.tx))return false;
    if(!(await lstat(q.tx)).isFile())throw new Error('Unsafe recovery journal');
    const t=JSON.parse(await readFile(q.tx,'utf8'));
    if(t.kind==='uninstall')return finishUninstall(p,t,run,checkpoint);
    if(typeof t.steam!=='string'||!t.steam.startsWith('/')||resolve(t.steam)!==t.steam)throw new Error('Invalid recovery Steam path');
    const marker=join(t.steam,'.cef-enable-remote-debugging');
    if(t.managerState && (typeof t.managerState.enabled!=='boolean'||typeof t.managerState.active!=='boolean'))throw new Error('Invalid service recovery state');
    const expected=[p.state,p.unit,p.autostart,q.desktop,q.active,q.bin,p.config,marker];
    if(t.marker!==marker||!Array.isArray(t.snapshots)||t.snapshots.length!==expected.length||t.snapshots.some((s:Snapshot,i:number)=>s.path!==expected[i]||!['absent','file','link'].includes(s.kind))||!t.desired||typeof t.release!=='string'||dirname(t.release)!==q.versions)throw new Error('Invalid recovery transaction');
    if(t.cleanup) {
        // Restoration/activation already committed. Remaining removal is explicitly owned and resumable.
        await removePlanned(t.cleanup,[t.release],checkpoint);
        await checkpoint('recovery-before-transaction-unlink'); await unlink(q.tx); return true;
    }
    for(const snap of t.snapshots as Snapshot[]) {
        if(!await exists(snap.path))continue;
        const now=await snapshot(snap.path); const oldMatch=now.kind===snap.kind&&now.value===snap.value;
        const desired=t.desired[snap.path]; const newMatch=desired&&(now.kind===desired.kind&&(now.kind==='file'?sha256(Buffer.from(now.value!,'base64'))===desired.hash:now.value===desired.value));
        const refreshed=snap.path===p.state&&t.refreshedState&&now.kind==='file'&&now.value===t.refreshedState.value;
        if(!oldMatch&&!newMatch&&!refreshed)throw new Error(`Modified recovery target preserved: ${snap.path}`);
    }
    const oldSnapshot=t.snapshots[0] as Snapshot;
    if(oldSnapshot.kind==='absent'&&!t.managerStopped) {
        if(await exists(p.unit)) { await run(['disable','--now',UNIT]); await checkpoint('recovery-manager-disabled'); }
        t.managerStopped=true; await atomic(q.tx,JSON.stringify(t)); await checkpoint('recovery-manager-journaled');
    }
    for(const snap of [...t.snapshots].reverse()) { await restore(snap); await checkpoint(`recovery-restored:${snap.path}`); }
    const old=await load(p);
    if(old) {
        for(const r of old.files)if(r.owned&&[p.unit,p.autostart,q.desktop].includes(r.path))Object.assign(r,await record(r.path));
        const value=JSON.stringify(old,null,2)+'\n';
        t.refreshedState={path:p.state,kind:'file',value:Buffer.from(value).toString('base64'),mode:0o600};
        // Publish permission first: either original snapshot or refreshed bytes remains recognizable on interruption.
        await atomic(q.tx,JSON.stringify(t)); await checkpoint('recovery-refreshed-state-permitted');
        await atomic(p.state,value); await checkpoint('recovery-refreshed-state-published');
        t.snapshots[0]=t.refreshedState; await atomic(q.tx,JSON.stringify(t)); await checkpoint('recovery-refreshed-snapshot-committed');
    }
    await run(['daemon-reload']); await checkpoint('recovery-reloaded');
    if(old) {await restoreService(run,t.managerState??{enabled:true,active:true}); await checkpoint('recovery-restarted');}
    if(!old?.releases?.includes(t.release)) {
        t.cleanup=await removalPlan([t.release]); await atomic(q.tx,JSON.stringify(t)); await checkpoint('recovery-cleanup-journaled');
        await removePlanned(t.cleanup,[t.release],checkpoint);
    }
    await checkpoint('recovery-before-transaction-unlink'); await unlink(q.tx); return true;
}
export async function installPackage(p:Paths,release:string,steamOption:string|undefined,run:Runner=systemctl,verify:Readiness=waitForService){const q=packagePaths(p);if(await exists(q.tx))throw new Error('Interrupted transaction: run snn recover before retrying');const m=await validateRelease(release);const old=await load(p);if(old)await validateState(p,old);const steam=await discoverSteam(p,steamOption??old?.steam);if(old&&steam!==old.steam)throw new Error('Steam root change refused');
    const dest=join(q.versions,`${m.version}-${m.buildId}`);if(old?.active===dest)throw new Error('Release already active');
    for(const path of [p.unit,p.autostart,q.desktop,q.active,q.bin])if(await exists(path)&&(!old||(!old.files.some((r:FileRecord)=>r.path===path)&&!old.links?.[path])))throw new Error(`Unowned collision: ${path}`);
    const marker=join(steam,'.cef-enable-remote-debugging');for(const path of [p.config,marker])if(await exists(path)&&!(await lstat(path)).isFile())throw new Error(`Unsafe shared file: ${path}`);
    const managerState=old?await serviceState(run):{enabled:false,active:false};
    if(await exists(dest)){if(!old?.releases?.includes(dest))throw new Error('Unowned version collision');await validateRelease(dest);}else{await mkdir(q.versions,{recursive:true,mode:0o700});const stage=`${dest}.stage-${process.pid}`;await cp(release,stage,{recursive:true,errorOnExist:true,force:false});await validateRelease(stage);await rename(stage,dest);}
    const texts:Record<string,string>={[p.unit]:unit(p,q.bin,steam),[p.autostart]:`[Desktop Entry]\nType=Application\nName=Steam native notifications\nNoDisplay=true\nExec=${desktopQuote(q.bin)} session\n`,[q.desktop]:`[Desktop Entry]\nType=Application\nName=Steam Native Notifications Settings\nComment=Configure desktop notifications from Steam\nExec=${desktopQuote(q.bin)} settings\nTerminal=false\nCategories=Settings;\n`,[p.config]:JSON.stringify({...CONFIG_DEFAULTS,devFire:false,devMode:false},null,2)+'\n',[marker]:''};
    const desired:Record<string,any>={};for(const [path,text]of Object.entries(texts))desired[path]={kind:'file',hash:sha256(text)};desired[q.active]={kind:'link',value:dest};desired[q.bin]={kind:'link',value:join(q.active,'snn')};
    const snapshots=await Promise.all([p.state,p.unit,p.autostart,q.desktop,q.active,q.bin,p.config,marker].map(snapshot));await atomic(q.tx,JSON.stringify({steam,marker,snapshots,desired,release:dest,managerState}));
    try{for(const [path,text]of [[p.config,JSON.stringify({...CONFIG_DEFAULTS,devFire:false,devMode:false},null,2)+'\n'],[marker,'']])if(!await exists(path!)){await mkdir(dirname(path!),{recursive:true,mode:0o700});await writeFile(path!,text!,{flag:'wx',mode:0o600});}
        await atomic(p.unit,unit(p,q.bin,steam));await atomic(p.autostart,`[Desktop Entry]\nType=Application\nName=Steam native notifications\nNoDisplay=true\nExec=${desktopQuote(q.bin)} session\n`);await atomic(q.desktop,`[Desktop Entry]\nType=Application\nName=Steam Native Notifications Settings\nComment=Configure desktop notifications from Steam\nExec=${desktopQuote(q.bin)} settings\nTerminal=false\nCategories=Settings;\n`);await link(q.active,dest);await link(q.bin,join(q.active,'snn'));
        const files:FileRecord[]=[];for(const path of [p.config,marker])files.push(old?.files.find((r:FileRecord)=>r.path===path)??(snapshots.find(s=>s.path===path)!.kind==='absent'?await record(path):{path,owned:false}));for(const path of [p.unit,p.autostart,q.desktop])files.push(await record(path));
        const state:State={version:2,steam,paths:p,active:dest,previous:old?.version===2?old.active:undefined,files,links:{[q.active]:dest,[q.bin]:join(q.active,'snn')},releases:[...new Set([...(old?.releases??[]),dest])]};desired[p.state]={kind:'file',hash:sha256(JSON.stringify(state,null,2)+'\n')};await atomic(q.tx,JSON.stringify({steam,marker,snapshots,desired,release:dest,managerState}));await atomic(p.state,JSON.stringify(state,null,2)+'\n');await run(['daemon-reload']);if(!old)await run(['enable',UNIT]);if(!old||managerState.active){await run(['restart',UNIT]);await verify(run,m.buildId);}await unlink(q.tx);return {...state,activation:!old||managerState.active?'verified':'staged; service remains stopped, startup unverified'};
    }catch(error){try{await recover(p,run);}catch(recovery:any){throw new Error(`Activation failed; recovery pending at ${q.tx}: ${recovery.message}`);}throw error;}}
export async function packageCommand(command:string,args:string[],p=setupPaths(),run:Runner=systemctl,checkpoint:Checkpoint=noCheckpoint){let release:string|undefined,steam:string|undefined;for(let i=0;i<args.length;i++){if(args[i]==='--release'&&args[i+1])release=resolve(args[++i]!);else if(args[i]==='--steam-dir'&&args[i+1])steam=args[++i];else throw new Error(`Unknown/incomplete option: ${args[i]}`);}const q=packagePaths(p);await mkdir(dirname(p.state),{recursive:true,mode:0o700});const lock=`${p.state}.lock`;try{await mkdir(lock);}catch{throw new Error(`Setup locked; after verifying no setup remains, remove ${lock}`);}try{
    if(command==='recover')return {recovered:await recover(p,run,checkpoint)};
    if(command==='uninstall'&&await exists(q.tx)){const pending=JSON.parse(await readFile(q.tx,'utf8'));if(pending.kind==='uninstall'){await finishUninstall(p,pending,run,checkpoint);return {preserved:[p.config,join(pending.steam,'.cef-enable-remote-debugging')],restartNeeded:true};}}
    if(await exists(q.tx))throw new Error('Recovery pending: run snn recover');
    if(['install','upgrade'].includes(command)){if(!release)throw new Error('Explicit --release extracted-directory required');for(const name of ['notify-send','gdbus','curl'])if(!Bun.which(name))throw new Error(`Missing required dependency: ${name}`);await validateRelease(release);const existing=await load(p);if(existing)await validateState(p,existing);const selected=await discoverSteam(p,steam??existing?.steam);for(const path of [p.unit,p.autostart,q.desktop,q.active,q.bin])if(await exists(path)&&(!existing||(!existing.files.some((r:FileRecord)=>r.path===path)&&!existing.links?.[path])))throw new Error(`Unowned collision: ${path}`);for(const path of [p.config,join(selected,'.cef-enable-remote-debugging')])if(await exists(path)&&!(await lstat(path)).isFile())throw new Error(`Unsafe shared file: ${path}`);await importSession(run);return await installPackage(p,release,steam,run);}
    const s=await load(p);if(!s)throw new Error('No managed installation');await validateState(p,s);if(s.version!==2)throw new Error('Migrate source installation using snn install --release DIR');
    if(command==='rollback'){if(!s.previous)throw new Error('No previous release');await importSession(run);return await installPackage(p,s.previous,s.steam,run);}
    if(command==='session'){if(!(await serviceState(run)).enabled)return {session:'disabled'};await importSession(run);await run(['restart',UNIT]);return {session:'activated'};}
    if(command==='uninstall') {
        const snapshots=await Promise.all([p.unit,p.autostart,q.desktop,q.bin,q.active,p.state].map(async path=>{const snap=await snapshot(path);const stat=await lstat(path);return {...snap,dev:stat.dev,ino:stat.ino};}));
        const t={kind:'uninstall',steam:s.steam,snapshots,releases:s.releases,removal:await removalPlan(s.releases),managerStopped:false};
        await atomic(q.tx,JSON.stringify(t)); await checkpoint('uninstall-journaled');
        await finishUninstall(p,t,run,checkpoint);
        return {preserved:[p.config,join(s.steam,'.cef-enable-remote-debugging')],restartNeeded:true};
    }throw new Error('Unknown package command');
}finally{await rm(lock,{recursive:true});}}
