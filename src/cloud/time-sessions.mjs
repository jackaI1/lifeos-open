import {AppError} from '../shared/errors.mjs';
import * as v from '../server/validation.mjs';
import {reassessTaskProgress} from '../domain/school.mjs';
const fields=['title','category','target','durationMs','automatic','startedAt','runningSince','elapsedMs','state','finishedAt','changedAt'];
export function validateTime(data){
 v.exactFields(data,fields);v.text(data.title,250,{required:true});v.text(data.category,80,{required:true});v.enumValue(data.state,['running','paused','finished']);v.boolean(data.automatic);
 for(const key of ['startedAt','changedAt'])v.number(data[key],1,Date.now()+300000);
 for(const key of ['durationMs','elapsedMs'])v.number(data[key],0,366*86400000);
 if(data.changedAt<data.startedAt)throw new AppError('Invalid timer chronology');
 if(data.state==='running'){v.number(data.runningSince,data.startedAt,Date.now()+300000);if(data.finishedAt!==null)throw new AppError('Running timer cannot be finished');}else if(data.runningSince!==null)throw new AppError('Stopped timer cannot have a running clock');
 if(data.state==='finished')v.number(data.finishedAt,data.startedAt,Date.now()+300000);else if(data.finishedAt!==null)throw new AppError('Invalid timer finish');
 if(data.target!==null){v.exactFields(data.target,['kind','id']);v.enumValue(data.target.kind,['task','devotional','prayer','lecture','project']);v.identifier(data.target.id);}
 return Object.fromEntries(fields.map(k=>[k,data[k]]));
}
export async function timeSessionRoute({store,req,path,body}){
 if(path==='/api/time-sessions'&&req.method==='GET'){
  const cursor=new URL(req.url).searchParams.get('before');let before;
  if(cursor){try{before=JSON.parse(cursor);}catch{throw new AppError('Invalid history cursor');}v.identifier(before.id);if(!Number.isFinite(Date.parse(before.at)))throw new AppError('Invalid history cursor');}
  const history=(await store.sql("SELECT * FROM records WHERE kind='time-session' AND json_extract(data,'$.state')='finished'"+(before?' AND (updated_at<? OR (updated_at=? AND id<?))':'')+" ORDER BY updated_at DESC,id DESC LIMIT 100",...(before?[before.at,before.at,before.id]:[])).all()).results;
  const active=before?[]:(await store.sql("SELECT * FROM records WHERE kind='time-session' AND json_extract(data,'$.state')<>'finished' ORDER BY updated_at DESC LIMIT 100").all()).results;
  const last=history.at(-1);
  return Response.json({items:[...active,...history].map(r=>({id:r.id,version:r.version,data:JSON.parse(r.data)})),next:history.length===100?{at:last.updated_at,id:last.id}:null});
 }
 const match=path.match(/^\/api\/time-sessions\/([-\w]+)$/);if(!match||req.method!=='POST')return null;
 v.exactFields(body,['data','mutationId']);const id=v.identifier(match[1]),data=validateTime(body.data),before=await store.get('time-session',id);
 // Offline actions can arrive out of order. Newer snapshots contain the entire elapsed clock.
 // A finished session never starts again due to an older pending device request.
 if(before&&(before.data.changedAt>=data.changedAt||before.data.state==='finished'))return Response.json({item:before});
 if(before&&before.data.startedAt!==data.startedAt)return Response.json({item:before});
 const at=new Date().toISOString(),after={kind:'time-session',id,data,version:(before?.version??0)+1,createdAt:before?.createdAt??at,updatedAt:at};
 const changes=[{kind:'time-session',id,before,after,auditId:crypto.randomUUID(),actor:'owner-time-tracking'}];
 if(data.state==='finished'&&data.target?.kind==='task'){
  const task=await store.get('task',data.target.id);if(task){
   const evidence={id:'timer-'+id,type:'work-session',minutes:data.elapsedMs/60000,at:new Date(data.finishedAt).toISOString(),timerTargetMinutes:data.durationMs/60000,overtimeMinutes:Math.max(0,data.elapsedMs-data.durationMs)/60000,source:'measured-timer'};
   if(!data.durationMs)evidence.overtimeMinutes=0;
   const {id:ignored,...next}=reassessTaskProgress({task:{...task.data,id:task.id},evidence});
   changes.push({kind:'task',id:task.id,before:task,after:{...task,data:next,version:task.version+1,updatedAt:at},auditId:crypto.randomUUID(),actor:'owner-time-tracking'});
  }
 }
 return Response.json(await store.commit({id:v.mutationId(body.mutationId),fingerprint:{path,body},changes,result:{item:after}}));
}
