// Install pinned, registry-integrity-verified packages into an isolated directory.
import {readFile,mkdir,writeFile,access,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'../..'),manifest=JSON.parse(await readFile(resolve(import.meta.dirname,'package.json'),'utf8')),lockPath=resolve(import.meta.dirname,'package-lock.json');
let lock;try{lock=JSON.parse(await readFile(lockPath,'utf8'));}catch{lock={name:manifest.name,version:manifest.version,lockfileVersion:3,requires:true,packages:{'':manifest}};}
const modules=resolve(root,'.runtime/browser-demo/node_modules');await mkdir(modules,{recursive:true});
for(const [name,version] of Object.entries(manifest.dependencies)){
 const key='node_modules/'+name;let entry=lock.packages[key];
 if(!entry){const res=await fetch('https://registry.npmjs.org/'+encodeURIComponent(name)+'/'+version);if(!res.ok)throw Error('Registry lookup failed: '+name);const meta=await res.json();entry=lock.packages[key]={version:meta.version,resolved:meta.dist.tarball,integrity:meta.dist.integrity,license:meta.license,...(meta.dependencies?{dependencies:meta.dependencies}:{})};}
 if(entry.version!==version||!entry.resolved.startsWith('https://registry.npmjs.org/'))throw Error('Untrusted dependency source');
 const destination=resolve(modules,name);try{await access(resolve(destination,'package.json'));continue;}catch{}
 const response=await fetch(entry.resolved);if(!response.ok)throw Error('Package download failed');const bytes=Buffer.from(await response.arrayBuffer()),[algorithm,expected]=entry.integrity.split('-');if(!['sha512','sha256'].includes(algorithm)||createHash(algorithm).update(bytes).digest('base64')!==expected)throw Error('Package integrity failed: '+name);
 await mkdir(dirname(destination),{recursive:true});await mkdir(destination,{recursive:true});const archive=resolve(root,'.runtime/browser-demo/'+name.replaceAll('/','-')+'.tgz');await writeFile(archive,bytes);try{execFileSync('/usr/bin/tar',['-xzf',archive,'--strip-components=1','-C',destination],{stdio:'ignore'});}finally{await rm(archive,{force:true});}
 console.log('Installed verified '+name+'@'+version);
}
await writeFile(lockPath,JSON.stringify(lock,null,2)+'\n');
