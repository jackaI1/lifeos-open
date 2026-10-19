import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.mjs';
import {createJobProcessor} from './process-job.mjs';
import {schoolIngestionWindow} from '../integrations/school.mjs';
const config=JSON.parse(await readFile(resolve(process.env.LIFEOS_CONFIG??'.lifeos/production/config.json'),'utf8'));
const store=new Store(join(config.dataDir,'lifeos.sqlite')),workerId=randomUUID();let stopping=false,current;
// This worker has no source-code mutation or deployment handler. Maintenance uses its own process.
const types=['support','inspire','coop-draft','devotional-archive','prayer-process','source-sync','backup','notification','notification-test'];
const processJob=createJobProcessor({store,config,workerId});
async function tick(){
 if(store.meta('migrationQuiesced'))return;
 store.heartbeat('worker',{status:current?'running':store.meta('automationPaused')?'paused':'idle',jobId:current?.id??null});
 const allowedTypes=types.filter(type=>type!=='coop-draft'||schoolIngestionWindow({now:new Date().toISOString(),timeZone:config.timeZone??'America/Toronto'}).allowed);
 const job=store.claim(workerId,{types:store.meta('automationPaused')?['support']:allowedTypes});if(!job)return;
 current=job;const controller=new AbortController();const timer=setInterval(()=>{if(stopping||store.job(job.id)?.cancelRequested)controller.abort();else if(!store.lease(job.id,workerId,store.job(job.id)?.progress??'Processing'))controller.abort();},10000);
 try{const result=await processJob(job,controller.signal);store.finish(job.id,workerId,result);store.heartbeat('worker',{status:'idle'},true);}catch(error){store.fail(job.id,workerId,error.message,{needsInput:error.code==='auth_required',usageLimited:error.code==='usage_limited'});}finally{clearInterval(timer);current=null;}
}
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{stopping=true;});
console.log(JSON.stringify({service:'lifeos-worker',environment:config.environment,status:'started'}));
while(!stopping){await tick();await new Promise(r=>setTimeout(r,5000));}store.close();
