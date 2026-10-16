import {expect,test} from 'bun:test';
import {mkdtemp,readFile,readdir,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {rotatingLog} from './log';
test('concurrent log writes retain only a private bounded current and previous file',async()=>{
 const dir=await mkdtemp('/tmp/snn-log-');try{
 const write=rotatingLog(join(dir,'standalone.log'),200);
 await Promise.all(Array.from({length:30},(_,i)=>write(`entry ${i}`)));
 expect((await readdir(dir)).sort()).toEqual(['standalone.log','standalone.log.1']);
 for(const name of await readdir(dir)){const info=await stat(join(dir,name));expect(info.size).toBeLessThanOrEqual(200);expect(info.mode&0o777).toBe(0o600);}
 expect(await readFile(join(dir,'standalone.log'),'utf8')).toContain('entry 29');
 }finally{await rm(dir,{recursive:true,force:true});}
});
