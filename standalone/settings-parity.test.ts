import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { createSettingsHost } from '../shared/host';
import { DEFAULTS } from '../shared/settings';
test('actual standalone adapter feeds actual frontend settings consumer, updates/removals/defaults and readonly write', async () => {
    const result = await Bun.build({entrypoints:[resolve(import.meta.dir,'../frontend/settings.ts')],target:'browser',format:'cjs',plugins:[{name:'adapter',setup(build){build.onResolve({filter:/^millennium$/},()=>({path:resolve(import.meta.dir,'adapter.ts')}));}}]}); expect(result.success).toBe(true);
    const context:any = createContext({module:{exports:{}},console,setTimeout,clearTimeout,__snnInitialConfig:{notifyOutsideGame:false,notificationCenterOnlyInGame:true}}); context.exports=context.module.exports;
    runInContext(await result.outputs[0]!.text(),context); const consumer=context.module.exports;
    expect(await consumer.loadSettings()).toEqual({...DEFAULTS,notifyOutsideGame:false,notificationCenterOnlyInGame:true});
    context.__snnConfig({showSteamInGame:false,devFire:'invalid'}); expect(consumer.settings()).toEqual({...DEFAULTS,showSteamInGame:false});
    expect((await consumer.settingsHost.write({notifyOutsideGame:true})).code).toBe('unsupported');
});
test('actual frontend consumer with Millennium boundary receives identical removal normalization', async () => {
    const result=await Bun.build({entrypoints:[resolve(import.meta.dir,'../frontend/settings.ts')],target:'browser',format:'cjs',plugins:[{name:'millennium-fixture',setup(build){build.onResolve({filter:/^millennium$/},()=>({path:'fixture',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const pluginConfig=globalThis.config;export const subscribePluginConfig=globalThis.subscribe;',loader:'js'}));}}]});
    let listener:(key:string,value:unknown)=>void=()=>{}; const values:any={notifyOutsideGame:false}; const context:any=createContext({module:{exports:{}},setTimeout,clearTimeout,config:{getAll:async()=>values,set:async()=>{throw Error('offline')}},subscribe:(fn:any)=>{listener=fn;return()=>{}}});context.exports=context.module.exports;runInContext(await result.outputs[0]!.text(),context);
    const consumer=context.module.exports;expect((await consumer.loadSettings()).notifyOutsideGame).toBe(false);listener('notifyOutsideGame',undefined);expect(consumer.settings().notifyOutsideGame).toBe(true);expect((await consumer.settingsHost.write({notifyOutsideGame:true})).code).toBe('unavailable');
});
test('typed settings writes resolve validation and transport errors consistently',async()=>{
    const host=createSettingsHost({getAll:async()=>({}),set:async()=>{throw Error('failure')},subscribe:()=>()=>{}});expect((await host.write({notifyOutsideGame:'bad'} as any)).ok).toBe(false);expect((await host.write({notifyOutsideGame:false})).ok).toBe(false);
});

test('settings page retains per-origin tab capability through reload while removing URL secret', async()=>{
 const { settingsScript }=await import('./settings-assets');const storage=new Map<string,string>();let calls=0;
 const launch=async(hash:string)=>{const elements:any={};const element=(id:string)=>elements[id]??=({textContent:'',replaceChildren(){},append(){}});const context:any=createContext({location:{hash,pathname:'/'},history:{replaceState(_a:any,_b:any,path:string){expect(path).toBe('/');}},sessionStorage:{getItem:(key:string)=>storage.get(key),setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)},document:{getElementById:element,createElement:()=>({append(){}}),querySelectorAll:():unknown[]=>[]},setInterval:()=>1,clearInterval(){},fetch:async(_url:string,opts:any)=>{expect(opts.headers.Authorization).toBe('Bearer fixture-secret');calls++;return {ok:true,json:async()=>({config:{values:DEFAULTS},hosts:[] as unknown[],schema:{},build:{version:'1',buildId:'a'.repeat(64)}})}},confirm:()=>true});runInContext(settingsScript,context);await Bun.sleep(1);return elements;};
 await launch('#fixture-secret');const reload=await launch('');expect(calls).toBe(2);expect(reload.version.textContent).toContain('a'.repeat(12));expect(reload.version.textContent).not.toContain('a'.repeat(64));await reload.close.onclick();expect(storage.has('snn-session')).toBe(false);
});
