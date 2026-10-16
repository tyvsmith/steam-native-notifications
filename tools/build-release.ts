import { mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ASSETS, sha256, validateRelease, type Manifest } from '../standalone/package-manifest';
import { BUILD_IDENTITY } from '../shared/host';
if(Bun.version!=='1.4.3')throw new Error('Release compiler must be Bun 1.4.3');
const pkg=JSON.parse(await readFile('package.json','utf8'));const toml=await readFile('millennium.toml','utf8');if(toml.match(/^version\s*=\s*"([^"]+)"/m)?.[1]!==pkg.version||BUILD_IDENTITY.version!==pkg.version)throw new Error('Version metadata differs');
const name=`snn-${pkg.version}-${BUILD_IDENTITY.buildId.slice(0,12)}-linux-x64`;const root=join('dist/releases',name);await rm(root,{recursive:true,force:true});await mkdir(root,{recursive:true});
const build=Bun.spawn([process.execPath,'build','standalone/cli.ts','--compile','--target=bun-linux-x64-baseline',`--outfile=${root}/snn`],{stdout:'inherit',stderr:'inherit'});if(await build.exited)throw new Error('Native compile failed');
for(const rel of ASSETS.filter(p=>p!=='snn')){await mkdir(join(root,rel,'..'),{recursive:true});await cp(rel,join(root,rel));}
const readelf=Bun.spawn(['readelf','--version-info',join(root,'snn')],{stdout:'pipe'});const info=await new Response(readelf.stdout).text();if(await readelf.exited)throw new Error('readelf required');const versions=[...info.matchAll(/GLIBC_(\d+\.\d+)/g)].map(m=>m[1]!).sort((a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);return x[0]!-y[0]!||x[1]!-y[1]!;});
const manifest:Manifest={format:2,version:pkg.version,buildId:BUILD_IDENTITY.buildId,target:'linux-x64',bun:'1.4.3',glibc:versions.at(-1)??'unknown',files:{}};for(const rel of ASSETS)manifest.files[rel]=sha256(await readFile(join(root,rel)));await writeFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');await validateRelease(root);
const tar=`dist/releases/${name}.tar.gz`;const child=Bun.spawn(['tar','-czf',tar,'-C','dist/releases',name],{stdout:'inherit',stderr:'inherit'});if(await child.exited)throw new Error('tar failed');await writeFile(`${tar}.sha256`,`${sha256(await readFile(tar))}  ${name}.tar.gz\n`);console.log(JSON.stringify({root,tar,glibc:manifest.glibc}));
