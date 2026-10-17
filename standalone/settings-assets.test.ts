import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { settingsScript } from './settings-assets';
import { startSettingsServer } from './settings-server';
import { DEFAULTS, SETTINGS_SCHEMA } from '../shared/settings';

function page() {
    const elements = new Map<string, any>();
    function element() { return { disabled:false, children:[] as any[], textContent:'', append(...children:any[]){this.children.push(...children);},replaceChildren(){this.children=[];} }; }
    const get = (id:string) => { if(!elements.has(id)) elements.set(id,element()); return elements.get(id); };
    let values = { ...DEFAULTS }; let offline=false; let poll!:()=>Promise<void>;
    const context:any = {location:{hash:'#token',pathname:'/'},sessionStorage:{getItem:()=>'',setItem(){},removeItem(){}},history:{replaceState(){}},document:{getElementById:get,createElement:element,querySelectorAll:()=>[...elements.values()]},setInterval:(fn:any)=>{poll=fn;},clearInterval(){},confirm:()=>true,
        fetch:async()=>{if(offline)throw Error('expired');return {ok:true,json:async()=>({config:{values:{...values},error:null as string | null},schema:SETTINGS_SCHEMA,platform:'linux',hosts:[{host:'standalone',present:true,state:'ready'}],build:{version:'test',buildId:'123456789012'},session:'test'})};}};
    runInNewContext(settingsScript,context);
    return {context,get,setValues: (patch: Partial<typeof DEFAULTS>) => { values = { ...values, ...patch }; },expire:()=>{offline=true;},poll:()=>poll()};
}
test('expired editor clears readiness and disables actions', async()=>{
    const p=page();await p.poll();expect(p.get('sample').disabled).toBe(false);
    p.expire();await p.poll();expect(p.get('status').textContent).toContain('Run snn settings');
    for(const id of ['sample','reset','close'])expect(p.get(id).disabled).toBe(true);
    expect(p.get('health').textContent).toContain('stale');
});

test('old polls cannot overwrite a later reset or reopen a closed page',async()=>{
 const p=page();await p.poll();const fetch=p.context.fetch;
 let deliver!:(value:unknown)=>void;
 p.context.fetch=()=>new Promise(resolve=>{deliver=resolve;});
 const stale=p.poll();p.context.fetch=fetch;
 await p.get('reset').onclick();const current=p.get('controls').children;
 deliver(await fetch());await stale;expect(p.get('controls').children).toBe(current);
 p.context.fetch=()=>new Promise(resolve=>{deliver=resolve;});
 const afterClose=p.poll();p.context.fetch=fetch;
 await p.get('close').onclick();deliver(await fetch());await afterClose;
 expect(p.get('sample').disabled).toBe(true);
 expect(p.get('result').textContent).toContain('closed');
});

test('server serves the same browser bundle exercised by the UI fixtures', async () => {
    const server = startSettingsServer();
    try {
        const response = await fetch(server.origin + '/settings.js');
        expect(response.headers.get('content-type')).toBe('text/javascript');
        expect(await response.text()).toBe(settingsScript);
    } finally { server.stop(); }
});

test('external editor exposes the ordered master and preserves disabled preferences', async () => {
    const p = page(); await p.poll();
    const section = () => p.get('controls').children[0];
    const controls = () => section().children.slice(1).map((row: any) => row.children[1]);
    expect(section().children[0].textContent).toBe('Operating system notifications');
    expect(controls().map((input: any) => input.id)).toEqual(['integrationEnabled', 'notifyInGame', 'showSteamInGame', 'notifyOutsideGame', 'showSteamOutsideGame']);
    p.setValues({ integrationEnabled: false }); await p.poll();
    expect(controls().map((input: any) => input.disabled)).toEqual([false, true, true, true, true]);
    expect(controls().map((input: any) => input.checked)).toEqual([false, true, true, true, false]);
    expect(p.get('sample').disabled).toBe(true);
    p.setValues({ integrationEnabled: true }); await p.poll();
    expect(controls().every((input: any) => !input.disabled)).toBe(true);
    expect(p.get('sample').disabled).toBe(false);
});
