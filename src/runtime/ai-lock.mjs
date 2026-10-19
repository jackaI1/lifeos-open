import {open,readFile,rename,unlink,mkdir} from 'node:fs/promises';import {dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
const defaultPath=fileURLToPath(new URL('../../.lifeos/ai-launch.lock',import.meta.url));
export async function acquireAILock({path=defaultPath,component,jobId}={}){
 if(!['ai','collector','maintenance'].includes(component)||typeof jobId!=='string'||jobId.length>100)throw Error('Invalid LifeOS AI lock scope');path=resolve(path);await mkdir(dirname(path),{recursive:true});let handle;
 try{handle=await open(path,'wx');}catch(error){if(error.code!=='EEXIST')throw error;const old=JSON.parse(await readFile(path,'utf8'));let alive=true;try{process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}if(old.schemaVersion===1&&!alive&&Date.now()-old.createdAt>15*60000){await rename(path,path+'.interrupted-'+randomUUID());handle=await open(path,'wx');}else throw Object.assign(Error('Another LifeOS AI job is active or its interrupted run is being reconciled'),{code:'ai_busy'});}
 const token=randomUUID();await handle.writeFile(JSON.stringify({schemaVersion:1,pid:process.pid,token,component,jobId,createdAt:Date.now()}));await handle.sync();await handle.close();let released=false;
 return async()=>{if(released)return;released=true;const saved=JSON.parse(await readFile(path,'utf8'));if(saved.token!==token)throw Error('LifeOS AI lock owner changed');await unlink(path);};
}
