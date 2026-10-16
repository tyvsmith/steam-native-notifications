import { expect, test } from 'bun:test';
import { serviceState, waitForService } from './service-lifecycle';
const run = async()=> 'MainPID=123\nActiveState=active\nSubState=running';
test('readiness accepts waiting Steam only for the service PID and expected protocol/build',async()=>{
    await waitForService(run,'new',async()=>({pid:123,build:{buildId:'new',protocolVersion:1},state:'waiting-for-steam'}),1);
    for(const status of [{pid:99,build:{buildId:'new',protocolVersion:1}},{pid:123,build:{buildId:'old',protocolVersion:1}},{pid:123,build:{buildId:'new',protocolVersion:2}}])await expect(waitForService(run,'new',async()=>status,1)).rejects.toThrow('timed out');
    await expect(waitForService(async()=> 'ActiveState=failed','new',async()=>({}),1)).rejects.toThrow('exited');
    await expect(waitForService(run,'new',async()=>{throw Error('offline');},1)).rejects.toThrow('offline');
});
test('manager state preserves disabled/inactive and refuses unknown/transitional state',async()=>{
    expect(await serviceState(async()=> 'UnitFileState=disabled\nActiveState=inactive')).toEqual({enabled:false,active:false});
    for(const value of ['','UnitFileState=masked\nActiveState=active','UnitFileState=enabled\nActiveState=activating'])await expect(serviceState(async()=>value)).rejects.toThrow();
});
