import {mkdir,lstat,realpath,open,readFile,rename,unlink,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';

export const localInferenceRoot='./.runtime/local Support/LifeOS/local-inference';
const rank={private:0,school:1,development:2,cooking:3},context=new AsyncLocalStorage();
class GateError extends Error{constructor(code){super(code);this.code=code;}}
export class LocalInferenceSettledFailure extends GateError{
 constructor(code='local_inference_failed'){if(!['local_inference_failed','local_model_rejected','local_http_rejected','local_recognition_failed'].includes(code))code='local_inference_failed';super(code);}
}
const deferred=()=>new GateError('local_inference_deferred');
const aborted=()=>new GateError('local_inference_aborted');
const uncertain=()=>new GateError('local_inference_uncertain');
const tokenShape=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
async function safeDirectory(path){const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o777)!==0o700||await realpath(path)!==path)throw deferred();}
async function metadata(path,{queued=false}={}){
 const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o777)!==0o600||s.size>4096||s.size<1)throw deferred();
 let m;try{m=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')throw e;throw deferred();}
 const keys=['schemaVersion','token','pid','priority','createdAt','state',...(queued?['order']:[])];
 if(m.schemaVersion!==1||!tokenShape.test(m.token)||!Number.isInteger(m.pid)||m.pid<1||m.pid>2147483647||!Object.hasOwn(rank,m.priority)||!Number.isSafeInteger(m.createdAt)||m.createdAt<0||!['queued','active','uncertain'].includes(m.state)||Object.keys(m).length!==keys.length||keys.some(k=>!Object.hasOwn(m,k))||(queued&&!/^[0-9]{1,30}$/.test(m.order)))throw deferred();
 return m;
}
async function exclusiveFile(path,value){const h=await open(path,'wx',0o600);try{await h.writeFile(JSON.stringify(value)+'\n');await h.sync();}finally{await h.close();}}
async function removeOwned(path,token){const m=await metadata(path,{queued:path.endsWith('.request.json')});if(m.token!==token)throw uncertain();await unlink(path);}
async function quarantine(path,token){try{const m=await metadata(path);if(m.token!==token)return;m.state='uncertain';const temporary=path+'.'+token+'.tmp';await exclusiveFile(temporary,m);await rename(temporary,path);}catch{ /* An unreadable active slot remains occupied for reconciliation. */ }}
function wait(ms,signal){if(signal?.aborted)return Promise.reject(aborted());return new Promise((resolve,reject)=>{const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);resolve();},stop=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(aborted());};const timer=setTimeout(finish,ms);signal?.addEventListener('abort',stop,{once:true});});}
async function candidates(root){const rows=[];for(const file of await readdir(root)){
 if(!/^[a-f0-9-]{36}\.request\.json$/.test(file))continue;
 const path=join(root,file);let row;try{row=await metadata(path,{queued:true});}catch(e){if(e.code==='ENOENT')continue;throw deferred();}
 if(file!==row.token+'.request.json'||row.state!=='queued')throw deferred();
 let dead=false;try{process.kill(row.pid,0);}catch(e){dead=e.code==='ESRCH';}
 if(dead){await removeOwned(path,row.token).catch(()=>{});continue;}rows.push(row);
 }return rows.sort((a,b)=>rank[a.priority]-rank[b.priority]||(BigInt(a.order)<BigInt(b.order)?-1:BigInt(a.order)>BigInt(b.order)?1:a.token.localeCompare(b.token)));
}

/** Gate around one fully observed inference/recognition, never an entire nested job.
 * Return only after native completion. Uncertain transport errors quarantine the
 * slot; abort, dead PID and timestamps alone never justify automatic takeover.
 */
export async function withLocalInference({priority,signal,root=localInferenceRoot,synthetic=false,pollMs=250,waitMs=priority==='private'?3_600_000:120_000}={},fn){
 if(typeof fn!=='function'||!Object.hasOwn(rank,priority)||!Number.isInteger(pollMs)||pollMs<1||pollMs>1000||!Number.isInteger(waitMs)||waitMs<1||waitMs>3_600_000||context.getStore())throw deferred();
 if(root!==localInferenceRoot&&!(synthetic===true&&/^\/private\/tmp\/lifeos-local-gate-[A-Za-z0-9]+$/.test(root)))throw deferred();
 if(signal?.aborted)throw aborted();
 if(root===localInferenceRoot){await safeDirectory('./.runtime/local Support/LifeOS');await mkdir(root,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});}
 await safeDirectory(root);
 const token=randomUUID(),request=join(root,token+'.request.json'),temporary=request+'.tmp',active=join(root,'active.json');
 const row={schemaVersion:1,token,pid:process.pid,priority,createdAt:Date.now(),state:'queued',order:process.hrtime.bigint().toString()};
 await exclusiveFile(temporary,row);await rename(temporary,request);const deadline=Date.now()+waitMs;let claimed=false,invoked=false;
 try{
  while(!claimed){
   if(signal?.aborted)throw aborted();if(Date.now()>=deadline)throw deferred();
   const eligible=(await candidates(root))[0];
   if(eligible?.token===token){
    const holder={schemaVersion:1,token,pid:process.pid,priority,createdAt:Date.now(),state:'active'};
    try{await exclusiveFile(active,holder);claimed=true;}catch(e){if(e.code!=='EEXIST')throw deferred();}
   }
   if(!claimed)await wait(Math.min(pollMs,Math.max(1,deadline-Date.now())),signal);
  }
  await removeOwned(request,token);
  if(signal?.aborted){await removeOwned(active,token);claimed=false;throw aborted();}
  invoked=true;
  try{const result=await context.run(token,()=>fn({signal}));await removeOwned(active,token);claimed=false;return result;}
  catch(e){if(e instanceof LocalInferenceSettledFailure){await removeOwned(active,token);claimed=false;throw e;}await quarantine(active,token);throw uncertain();}
 }finally{
  await removeOwned(request,token).catch(()=>{});
  if(claimed&&!invoked){await removeOwned(active,token).catch(()=>{});}
 }
}
