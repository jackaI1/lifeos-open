import {timeSessionRoute} from './time-sessions.mjs';
import {retiredProductionDevotional} from '../shared/production-test-policy.mjs';
import {RecordPlan} from './plan.mjs';import {AppError} from '../shared/errors.mjs';import {digest} from './store.mjs';
import {publicValue,safeJob,devotionalView,completionFields,syncDevotional,progress,actionResult} from '../shared/application.mjs';import {syncCoopTask} from '../server/coop-tasks.mjs';import * as v from '../server/validation.mjs';
const unpack=r=>({kind:r.kind,id:r.id,data:JSON.parse(r.data),version:r.version,createdAt:r.created_at,updatedAt:r.updated_at});
const jobView=r=>r?{id:r.id,type:r.type,payload:JSON.parse(r.payload),status:r.status,attempts:r.attempts,maxAttempts:r.max_attempts,createdAt:new Date(r.created_at).toISOString(),updatedAt:new Date(r.updated_at).toISOString(),result:r.result?JSON.parse(r.result):null,error:r.error,progress:r.progress,cancelRequested:!!r.cancel_requested}:null;
export async function loadPlan(store,kinds,{auditId=null,calendarWindow=null}={}){
 kinds=[...new Set(kinds)];const placeholders=kinds.map(()=>'?').join(',');
 const statements=[store.sql(`SELECT * FROM records WHERE kind IN (${placeholders}) LIMIT 3001`,...kinds),store.sql(`SELECT * FROM kind_revisions WHERE kind IN (${placeholders})`,...kinds),store.sql("SELECT key,value FROM meta WHERE key IN ('automationPaused','maintenancePaused')")];
 if(calendarWindow&&kinds.includes('calendar-event')){const others=kinds.filter(k=>k!=='calendar-event');statements[0]=store.sql(`SELECT * FROM records WHERE ${others.length?`kind IN (${others.map(()=>'?').join(',')}) OR `:''}kind='calendar-event' AND COALESCE(json_extract(data,'$.start.dateTime'),json_extract(data,'$.start.date'))<? AND COALESCE(json_extract(data,'$.end.dateTime'),json_extract(data,'$.end.date'))>=? LIMIT 3001`,...others,calendarWindow.through,calendarWindow.from);}
 if(auditId)statements.push(store.sql('SELECT * FROM audit WHERE id=? OR undo_of=?',auditId,auditId));
 const batch=await store.db.batch(statements),records=batch[0].results;if(records.length>3000)throw new AppError('This operation requires a smaller data page',413);
 const plan=new RecordPlan({records:records.map(unpack),kinds,audit:batch[3]?.results??[],meta:Object.fromEntries(batch[2].results.map(r=>[r.key,JSON.parse(r.value)]))});
 plan.epochChecks=kinds.map(kind=>store.assertion('SELECT COALESCE((SELECT version FROM kind_revisions WHERE kind=?),0)=?',[kind,batch[1].results.find(r=>r.kind===kind)?.version??0]));return plan;
}
export async function commitPlan(store,plan,{id,fingerprint,result,extra=[]}){
 const metadata=plan.metaChanges.map(m=>store.sql('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',m.key,JSON.stringify(m.value)));
 return store.commit({id,fingerprint,changes:plan.changes,jobs:plan.queued,result,preconditions:plan.epochChecks,extra:[...metadata,...extra]});
}
async function jobViews(store,rows){const beats=(await store.sql('SELECT name,at,details FROM heartbeats').all()).results;return rows.map(r=>{const job=jobView(r);if(job.status==='queued'&&r.component!=='cloud'){const heartbeat=beats.find(b=>b.name===r.component),details=heartbeat?.details?JSON.parse(heartbeat.details):null;if(details?.status==='needs-sign-in')job.progress='needs sign-in';else if(!heartbeat||Date.now()-heartbeat.at>120000)job.progress='waiting for computer';else job.progress??='waiting for the '+r.component+' worker';}return safeJob(job);});}
export async function jobList(store){return {jobs:await jobViews(store,(await store.sql('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50').all()).results)};}
export async function recordRoute({store,req,path,body,config}){
 const response=value=>Response.json(value);
 const timing=await timeSessionRoute({store,req,path,body});if(timing)return timing;
 if(req.method==='PUT'&&/^\/api\/devotionals\/\d{4}-\d{2}-\d{2}$/.test(path)&&retiredProductionDevotional(config,path.slice(-10)))throw new AppError('This retired activation-test record cannot be created in production.',403,'production_test_denied');

 if(body?.mutationId&&!['GET','HEAD'].includes(req.method)){const prior=await store.mutation(v.mutationId(body.mutationId),await digest(JSON.stringify({path,body})));if(prior)return response(prior);}
 const match=path.match(/^\/api\/records\/([-\w]+)(?:\/([-\w]+))?$/);
 if(match){const [,kind,id]=match;if(!v.readableKinds.includes(kind))throw new AppError('Not found',404);
  if(req.method==='GET'){if(!id){const q=new URL(req.url).searchParams;return response({items:publicValue(await store.list(kind,{limit:Math.min(1000,Math.max(1,Math.floor(Number(q.get('limit'))||500))),offset:Math.max(0,Math.floor(Number(q.get('offset'))||0))}))});}const item=await store.get(kind,id);if(!item)throw new AppError('Not found',404);return response({item:publicValue(item)});}
  if(req.method==='PUT'&&id){v.identifier(id);v.version(body.version);const clean=v.recordData(kind,body.data),plan=await loadPlan(store,[kind,'settings','task',...(kind==='accountability-draft'?['devotional']:[])]);const old=plan.get(kind,id);if(kind==='task'&&clean.courseId){const course=await store.get('course',clean.courseId);if(!course||course.data.archived)throw new AppError('Choose an existing course');plan.epochChecks.push(store.assertion("SELECT version=? FROM records WHERE kind='course' AND id=?",[course.version,course.id]));}if(kind==='coursework'&&old?.data.document&&!clean.document&&clean.text!==undefined&&clean.text!==old.data.text)throw new AppError('This document now has formatting. Reload the document editor; your device draft is preserved.',409,'formatted_document_upgrade');if(kind==='accountability-draft'){const entry=plan.get('devotional',clean.entryId);if(!entry?.data.complete||entry.version!==clean.entryVersion||id!==clean.entryId)throw new AppError('The devotional changed. Reopen the message before confirming.',409);clean.approvedAt=clean.status==='approved'?new Date().toISOString():null;clean.lastApprovedText=clean.status==='approved'?clean.text:old?.data.lastApprovedText??(old?.data.status==='approved'?old.data.text:null);clean.lastApprovedAt=clean.approvedAt??old?.data.lastApprovedAt??old?.data.approvedAt??null;}const item=plan.put(kind,id,{...old?.data,...clean},body.version),extra=[];
   if(kind==='coursework'&&item.data.taskId){progress(plan,item.data.taskId,{id:item.id+':'+item.version,type:'saved-draft',at:item.updatedAt,recordId:item.id});}if(kind==='coop-role')syncCoopTask(plan,item);return response(await commitPlan(store,plan,{id:v.mutationId(body.mutationId),fingerprint:{path,body},extra,result:{item:publicValue(item)}}));}
 }
 const devo=path.match(/^\/api\/devotionals\/([-\w]+)$/);
 if(devo&&req.method==='PUT'&&retiredProductionDevotional(config,devo[1]))throw new AppError('This retired activation-test record cannot be created in production.',403,'production_test_denied');
 if(devo){const id=v.identifier(devo[1]),plan=await loadPlan(store,['devotional','spiritual','settings']),old=plan.get('devotional',id);const date=v.date(old?.data.date??body?.date??new URL(req.url).searchParams.get('day')??id);if(body?.date&&old&&body.date!==old.data.date)throw new AppError('An entry cannot silently move to another day');if(retiredProductionDevotional(config,date)&&req.method==='PUT')throw new AppError('Retired production test date',403);
  if(req.method==='GET')return response({entry:old?devotionalView(plan,old):{id,date,points:Array(7).fill(''),passage:'',complete:false,completedAt:null,version:0,updatedAt:null,archiveStatus:'not-needed'}});
  if(req.method==='PUT'){
   const clean=v.devotional(body),completion=completionFields(clean,old?.data,date,plan);delete clean.observedAt;
   const item=plan.put('devotional',id,{...old?.data,...clean,date,...completion},body.version);syncDevotional(plan,item);
   return response(await commitPlan(store,plan,{id:v.mutationId(body.mutationId),fingerprint:{path,body},result:{entry:devotionalView(plan,item)}}));
  }
 }
 if(path==='/api/devotionals'&&req.method==='GET'){const plan=await loadPlan(store,['devotional']);return response({entries:plan.list('devotional').map(r=>devotionalView(plan,r))});}
 if(path==='/api/jobs'&&req.method==='GET'){const taskId=new URL(req.url).searchParams.get('taskId');if(taskId){v.identifier(taskId);const rows=(await store.sql("SELECT * FROM jobs WHERE type='inspire' AND json_extract(payload,'$.taskId')=? ORDER BY created_at DESC LIMIT 1",taskId).all()).results;return response({jobs:await jobViews(store,rows)});}return response(await jobList(store));}
 if(path==='/api/jobs'&&req.method==='POST'){
  const j=v.jobRequest(body),kind={support:'support-thread',inspire:'task','coop-draft':'coop-role'}[j.type],recordId=j.payload.threadId??j.payload.taskId??j.payload.roleId??j.payload.sessionId;
  if(j.type==='inspire'){const prior=await store.sql("SELECT * FROM jobs WHERE type='inspire' AND json_extract(payload,'$.taskId')=? AND status IN ('queued','running','needs-input') ORDER BY created_at DESC LIMIT 1",recordId).first();if(prior)return response({job:(await jobViews(store,[prior]))[0]});}
  const plan=await loadPlan(store,['attachment','support-message',...(kind?[kind]:[])]);
  for(const id of j.payload.attachmentIds??[])if(!plan.get('attachment',id))throw new AppError('Attachment not found',404);
  if(kind&&!plan.get(kind,recordId))throw new AppError('Requested record not found',404);
  if(j.type==='support'){if(plan.get('support-thread',j.payload.threadId)?.data.scope)throw new AppError('Use this conversation in its Assistant page',409);const msg=plan.put('support-message',crypto.randomUUID(),{threadId:j.payload.threadId,role:'user',text:j.payload.message,attachmentIds:j.payload.attachmentIds??[]},0);j.payload.messageId=msg.id;}
  const job=plan.enqueue(j.type,j.payload,{priority:j.type==='maintenance'?8:5,authority:j.type==='maintenance'?'authenticated-intentional-report':'owner'});
  return response(await commitPlan(store,plan,{id:v.mutationId(body.mutationId),fingerprint:{path,body},result:{job:safeJob(job)}}));
 }
 const jm=path.match(/^\/api\/jobs\/([-\w]+)(\/cancel)?$/);
 if(jm){const job=await store.sql('SELECT * FROM jobs WHERE id=?',jm[1]).first();if(!job)throw new AppError('Job not found',404);if(req.method==='GET'&&!jm[2])return response({job:(await jobViews(store,[job]))[0]});if(req.method==='POST'&&jm[2]){if(job.type==='cooking-help')throw new AppError('Cancel this question in Cooking so its original result can be retained.',403,'cooking_help_denied');await store.sql("UPDATE jobs SET cancel_requested=1,status=CASE WHEN status IN ('queued','needs-input','usage-limited') THEN 'cancelled' ELSE status END,updated_at=? WHERE id=? AND status NOT IN ('completed','failed','cancelled')",Date.now(),job.id).run();return response({job:safeJob(jobView(await store.sql('SELECT * FROM jobs WHERE id=?',job.id).first()))});}}
 const action=path.match(/^\/api\/actions\/([-\w]+)$/)?.[1];
 if(action&&req.method==='POST'){
  const kinds={undo:['ticket-spend','presence-correction','devotional','spiritual','task','settings','coop-role'], 'spiritual-complete':['spiritual','devotional','settings'],presence:['presence','settings'],'presence-correct':['presence-correction','settings'],'ticket-spend':['ticket-spend','settings'],'task-progress':['work-session','task'],'notification-read':['notification'],'push-subscribe':['push-subscription'],'push-test':['push-subscription'],backup:[], 'automation-pause':[]}[action];
  if(kinds){if(action==='undo'){const a=await store.sql('SELECT kind FROM audit WHERE id=?',v.identifier(body.auditId)).first();if(a)kinds.push(a.kind);}
   const plan=await loadPlan(store,kinds.length?kinds:['settings'],{auditId:action==='undo'?body.auditId:null}),result=actionResult(action,body,plan,config);
   return response(await commitPlan(store,plan,{id:v.mutationId(body.mutationId),fingerprint:{path,body},result}));
  }
 }
 return null;
}
