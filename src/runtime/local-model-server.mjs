import {spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {appendFile,mkdir,readFile} from 'node:fs/promises';
import {modelRuntime} from './local-model-config.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const config=process.env.LIFEOS_CONFIG?JSON.parse(await readFile(process.env.LIFEOS_CONFIG,'utf8')):null;
const {executable,stateDir:dir,env}=modelRuntime(config,{root});
await mkdir(dir,{recursive:true,mode:0o700});
// A second startup entry must not launch a competing server.
try{const r=await fetch('http://127.0.0.1:11434/api/version',{signal:AbortSignal.timeout(2000)});if(r.ok)process.exit(0);}catch{}
let stopping=false,child,attempts=0;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;child?.kill();});
while(!stopping){
 child=spawn(executable,['serve'],{cwd:root,env,windowsHide:true,stdio:['ignore','ignore','ignore']});
 const code=await new Promise(done=>{child.once('error',()=>done(-1));child.once('exit',done);});
 if(stopping)break;
 await appendFile(resolve(dir,'lifecycle.log'),new Date().toISOString()+' server exited '+code+'\n');
 if(++attempts>=5)break;await new Promise(r=>setTimeout(r,Math.min(60000,10000*2**attempts)));
}
