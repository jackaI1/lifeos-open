import {schoolPath,schoolUrl} from '../shared/service-config.mjs';
import {timeSessionRoute} from './time-sessions.mjs';
import {retiredProductionDevotional} from '../shared/production-test-policy.mjs';
import {RecordPlan} from './plan.mjs';import {AppError} from '../shared/errors.mjs';import {digest} from './store.mjs';
import {validateSchoolWindows} from './school-schedule.mjs';import {localDate,weekday} from '../domain/time.mjs';
import {publicValue,safeJob,devotionalView,completionFields,syncDevotional,progress,actionResult,devotionalDigest} from '../shared/application.mjs';import {syncCoopTask} from '../server/coop-tasks.mjs';import * as v from '../server/validation.mjs';
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
async function jobViews(store,rows){const beats=(await store.sql('SELECT name,at,details FROM heartbeats').all()).results;const ids=rows.filter(r=>r.type==='school-collect'&&r.status==='completed').map(r=>r.id),batches=ids.length?(await store.sql("SELECT id,json_extract(data,'$.status') status,json_extract(data,'$.reason') reason,json_extract(data,'$.complete') complete,json_extract(data,'$.coverage') coverage FROM records WHERE kind='school-batch' AND id IN ("+ids.map(()=>'?').join(',')+")",...ids).all()).results:[];return rows.map(r=>{const job=jobView(r);const batch=batches.find(b=>b.id===r.id);if(batch)job.result={...job.result,collected:batch.status,reason:batch.reason,reconciliationPending:!batch.complete,coverage:batch.coverage};if(job.status==='queued'&&r.component!=='cloud'){const heartbeat=beats.find(b=>b.name===r.component),details=heartbeat?.details?JSON.parse(heartbeat.details):null;if(details?.status==='needs-sign-in')job.progress='needs sign-in';else if(!heartbeat||Date.now()-heartbeat.at>120000)job.progress='waiting for computer';else job.progress??='waiting for the '+r.component+' worker';}return safeJob(job);});}
export async function jobList(store){return {jobs:await jobViews(store,(await store.sql('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50').all()).results)};}
export async function recordRoute({store,req,path,body,config}){
 const response=value=>Response.json(value);
 const timing=await timeSessionRoute({store,req,path,body});if(timing)return timing;
 if(req.method==='PUT'&&/^\/api\/devotionals\/\d{4}-\d{2}-\d{2}$/.test(path)&&retiredProductionDevotional(config,path.slice(-10)))throw new AppError('This retired activation-test record cannot be created in production.',403,'production_test_denied');

 if(body?.mutationId&&!['GET','HEAD'].includes(req.method)){const prior=await store.mutation(v.mutationId(body.mutationId),await digest(JSON.stringify({path,body})));if(prior)return response(prior);}
 const match=path.match(/^\/api\/records\/([-\w]+)(?:\/([-\w]+))?$/);
 if(match){const [,kind,id]=match;if(!v.readableKinds.includes(kind))throw new AppError('Not found',404);
  if(req.method==='GET'){if(!id){const q=new URL(req.url).searchParams;return response({items:publicValue(await store.list(kind,{limit:Math.min(1000,Math.max(1,Math.floor(Number(q.get('limit'))||500))),offset:Math.max(0,Math.floor(Number(q.get('offset'))||0))}))});}const item=await store.get(kind,id);if(!item)throw new AppError('Not found',404);return response({item:publicValue(item)});}
  if(req.method==='PUT'&&id){v.identifier(id);v.version(body.version);const clean=v.recordData(kind,body.data),plan=await loadPlan(store,[kind,'settings','task',...(kind==='coursework'?['school-source']:[]),...(kind==='accountability-draft'?['devotional']:[])]);const old=plan.get(kind,id);if(kind==='coursework'&&old?.data.document&&!clean.document&&clean.text!==undefined&&clean.text!==old.data.text)throw new AppError('This document now has formatting. Reload the document editor; your device draft is preserved.',409,'formatted_document_upgrade');if(kind==='accountability-draft'){const entry=plan.get('devotional',clean.entryId);if(!entry?.data.complete||entry.version!==clean.entryVersion||id!==clean.entryId)throw new AppError('The devotional changed. Reopen the message before confirming.',409);clean.approvedAt=clean.status==='approved'?new Date().toISOString():null;clean.lastApprovedText=clean.status==='approved'?clean.text:old?.data.lastApprovedText??(old?.data.status==='approved'?old.data.text:null);clean.lastApprovedAt=clean.approvedAt??old?.data.lastApprovedAt??old?.data.approvedAt??null;}if(kind==='settings')validateSchoolWindows({...old?.data,...clean},config.schoolBrowserWindows);const item=plan.put(kind,id,{...old?.data,...clean},body.version),extra=[];
   if(kind==='coursework'&&item.data.taskId){progress(plan,item.data.taskId,{id:item.id+':'+item.version,type:'saved-draft',at:item.updatedAt,recordId:item.id});if(old?.data.text!==item.data.text){const task=plan.get('task',item.data.taskId),source=plan.list('school-source').find(s=>s.data.courseId===task.data.courseId&&s.data.coverage==='complete');
    extra.push(store.sql("UPDATE jobs SET status='cancelled',cancel_requested=1,progress='Superseded by the latest saved draft' WHERE type='school-interpretation' AND json_extract(payload,'$.draftId')=? AND status IN ('queued','running','needs-input') AND COALESCE(json_extract(payload,'$.draftVersion'),0)<?",id,item.version));
    if(source){const job=plan.enqueue('school-interpretation',{sourceId:source.id,sourceHash:source.data.contentHash,taskId:task.id,draftId:id,draftVersion:item.version},{priority:2,authority:'saved-draft-reassessment'});job.availableAt=Date.now()+120000;}
   }}if(kind==='coop-role')syncCoopTask(plan,item);return response(await commitPlan(store,plan,{id:v.mutationId(body.mutationId),fingerprint:{path,body},extra,result:{item:publicValue(item)}}));}
 }
 if(path==='/api/devotional-history/index'&&req.method==='GET'){
  const q=new URL(req.url).searchParams,after=q.get('after')??'',day=q.get('day');if(after)v.identifier(after);if(day)v.date(day);const filter=day?" AND COALESCE(json_extract(data,'$.displayOverrides.date'),json_extract(data,'$.sourceUpdateDay'),json_extract(data,'$.historyReconciliation.devotionalDate'),json_extract(data,'$.date'))=?":'';
  const rows=(await store.sql("SELECT id,kind,json_object('validSeven',CASE WHEN json_array_length(data,'$.points')=7 AND NOT EXISTS(SELECT 1 FROM json_each(json_extract(data,'$.points')) WHERE trim(COALESCE(value,''))='') THEN 1 ELSE 0 END,'passage',json_extract(data,'$.passage'),'bookId',json_extract(data,'$.bookId'),'date',json_extract(data,'$.date'),'sourceUpdateDay',json_extract(data,'$.sourceUpdateDay'),'sourcePresent',json_extract(data,'$.sourcePresent'),'author',json_extract(data,'$.author'),'kind',json_extract(data,'$.kind'),'historyRole',json_extract(data,'$.historyRole'),'displayOverrides',json_extract(data,'$.displayOverrides'),'historyReconciliation',json_extract(data,'$.historyReconciliation')) data FROM records WHERE kind='devotional-import' AND id>?"+filter+" ORDER BY id LIMIT 501",after,...(day?[day]:[])).all()).results;
  return response({items:rows.slice(0,500).map(r=>({id:r.id,kind:r.kind,data:JSON.parse(r.data)})),nextCursor:rows.length>500?rows[499].id:null});
 }
 if(path==='/api/devotional-history'&&req.method==='GET'){
  const q=new URL(req.url).searchParams,limit=Math.min(50,Math.max(1,Number(q.get('limit')??50))),offset=Math.max(0,Number(q.get('offset')??0)),day=q.get('day');if(!Number.isInteger(limit)||!Number.isInteger(offset))throw new AppError('Invalid history page');if(day)v.date(day);
  const dayClause=day?" AND COALESCE(json_extract(data,'$.displayOverrides.date'),json_extract(data,'$.sourceUpdateDay'),json_extract(data,'$.historyReconciliation.devotionalDate'),json_extract(data,'$.date'))=?":"";
  const rows=(await store.sql("SELECT * FROM records WHERE kind='devotional-import' AND json_extract(data,'$.kind')='journal-entry' AND COALESCE(json_extract(data,'$.sourcePresent'),1)!=0 AND COALESCE(json_extract(data,'$.historyRole'),'')!='book-section' AND json_array_length(data,'$.points')=7 AND NOT EXISTS(SELECT 1 FROM json_each(json_extract(data,'$.points')) WHERE trim(COALESCE(value,''))='')"+dayClause+" ORDER BY id LIMIT ? OFFSET ?",...(day?[day]:[]),limit,offset).all()).results;return response({items:rows.map(unpack).map(publicValue)});
 }
 const archiveRetryPath=path.match(/^\/api\/devotionals\/([-\w]+)\/archive\/retry$/);
 if(archiveRetryPath&&req.method==='POST'){
  const date=v.identifier(archiveRetryPath[1]),plan=await loadPlan(store,['devotional','devotional-archive-state']),item=plan.get('devotional',date);v.version(body.version);
  if(!item||item.version!==body.version)throw new AppError('The saved entry changed. Reload before retrying.',409,'conflict');
  if(!item.data.archiveRequested||(item.data.type==='custom'?!item.data.customText?.trim():!item.data.bookId||item.data.points?.length!==7||item.data.points.some(p=>!p.trim())))throw new AppError('Save the selected passage and seven responses before retrying.');
  const prior=plan.get('devotional-archive-state',date);plan.put('devotional-archive-state',date,{...prior?.data,targetHash:devotionalDigest(item.data),targetVersion:item.version,archiveStatus:'queued'},prior?.version??0);
  const job=plan.enqueue('devotional-archive',{date,version:item.version},{priority:2,authority:'explicit-owner-retry'});
  return response(await commitPlan(store,plan,{id:v.mutationId(body.mutationId),fingerprint:{path,body},result:{queued:true,job},extra:[store.sql("UPDATE jobs SET status='cancelled',cancel_requested=1 WHERE type='devotional-archive' AND json_extract(payload,'$.date')=? AND status='queued' AND id<>?",date,job.id)]}));
 }
 const archivePath=path.match(/^\/api\/devotionals\/([-\w]+)\/archive$/);
 if(archivePath&&req.method==='GET'){
  const date=v.identifier(archivePath[1]),item=await store.get('devotional',date),state=await store.get('devotional-archive-state',date);
  if(!item||state?.data.targetHash!==devotionalDigest(item.data))return response({status:'not-requested'});
  if(state.data.archiveStatus==='archived')return response({status:'archived'});
  const blocked=await store.meta('devotional-archive-blocked');if(blocked&&item.data.type!=='custom')return response({status:'failed',error:blocked.message});
  const job=await store.sql("SELECT status,error FROM jobs WHERE type='devotional-archive' AND json_extract(payload,'$.date')=? AND json_extract(payload,'$.version')=? ORDER BY created_at DESC LIMIT 1",date,item.version).first();
  return response({status:job?.status==='running'?'running':job?.error||job?.status==='failed'?'failed':job?.status??'queued',error:job?.error??null});
 }
 const devo=path.match(/^\/api\/devotionals\/([-\w]+)$/);
 if(devo&&req.method==='PUT'&&retiredProductionDevotional(config,devo[1]))throw new AppError('This retired activation-test record cannot be created in production.',403,'production_test_denied');
 if(devo){const id=v.identifier(devo[1]),plan=await loadPlan(store,['devotional','spiritual','settings','devotional-archive-state']),old=plan.get('devotional',id);const date=v.date(old?.data.date??body?.date??new URL(req.url).searchParams.get('day')??id);if(body?.date&&old&&body.date!==old.data.date)throw new AppError('An entry cannot silently move to another day');if(retiredProductionDevotional(config,date)&&req.method==='PUT')throw new AppError('Retired production test date',403);
  if(req.method==='GET')return response({entry:old?devotionalView(plan,old):{id,date,points:Array(7).fill(''),passage:'',complete:false,completedAt:null,version:0,updatedAt:null,archiveStatus:'not-needed'}});
  if(req.method==='PUT'){
   const clean=v.devotional(body),completion=completionFields(clean,old?.data,date,plan);delete clean.observedAt;
   const requested=body.archiveRequested===true;
   const item=plan.put('devotional',id,{...old?.data,...clean,date,...completion,archiveRequested:requested,archiveStatus:requested?'queued':'not-requested'},body.version);syncDevotional(plan,item);
   if(requested){const prior=plan.get('devotional-archive-state',id);plan.put('devotional-archive-state',id,{...prior?.data,targetHash:devotionalDigest(item.data),targetVersion:item.version,archiveStatus:'queued'},prior?.version??0);plan.enqueue('devotional-archive',{date:id,entryId:id,version:item.version},{priority:2,authority:'explicit-owner-save'});}
   return response(await commitPlan(store,plan,{id:v.mutationId(body.mutationId),fingerprint:{path,body},result:{entry:devotionalView(plan,item)},extra:requested?[store.sql("UPDATE jobs SET status='cancelled',cancel_requested=1,progress='Superseded by explicit Save' WHERE type='devotional-archive' AND json_extract(payload,'$.date')=? AND json_extract(payload,'$.version')<? AND status='queued'",id,item.version)]:[]}));
  }
 }
 if(path==='/api/devotionals'&&req.method==='GET'){const plan=await loadPlan(store,['devotional','devotional-archive-state']);return response({entries:plan.list('devotional').map(r=>devotionalView(plan,r))});}
 if(path==='/api/source-refresh/cancel'&&req.method==='POST'){v.exactFields(body,['requestId']);const requestId=v.mutationId(body.requestId),jobId='source-refresh-'+(await digest(requestId)).slice(0,32);await store.db.batch([store.sql("INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO NOTHING",'source-refresh-cancel:'+requestId,String(Date.now())),store.sql("UPDATE jobs SET cancel_requested=1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,updated_at=? WHERE id=? AND status IN ('queued','running','needs-input')",Date.now(),jobId)]);return response({cancelled:true});}
 if(path==='/api/jobs'&&req.method==='GET'){const taskId=new URL(req.url).searchParams.get('taskId');if(taskId){v.identifier(taskId);const rows=(await store.sql("SELECT * FROM jobs WHERE type='inspire' AND json_extract(payload,'$.taskId')=? ORDER BY created_at DESC LIMIT 1",taskId).all()).results;return response({jobs:await jobViews(store,rows)});}return response(await jobList(store));}
 if(path==='/api/jobs'&&req.method==='POST'){
  const j=v.jobRequest(body),kind={support:'support-thread',inspire:'task','coop-draft':'coop-role','prayer-process':'prayer-session'}[j.type],recordId=j.payload.threadId??j.payload.taskId??j.payload.roleId??j.payload.sessionId;
  if(j.type==='source-sync'&&j.payload.provider==='school'){
   if(await store.meta('source-refresh-cancel:'+v.mutationId(body.mutationId)))return response({job:{status:'cancelled'}});
   if(config.excludeSundaySchool===true&&weekday(localDate(Date.now(),'America/Toronto'))===0)throw new AppError('School collection is excluded on Sunday');
   const existing=await store.sql("SELECT * FROM jobs WHERE type='school-collect' AND status IN ('queued','running','needs-input') ORDER BY created_at LIMIT 1").first();if(existing)return response({job:safeJob(jobView(existing))});
   const provider='learn',courses=(await store.list('course')).filter(c=>schoolPath(c.data.source?.sourceUrl,/^\/d2l\/home\/\d+\/?$/,config)),cursor=Number(await store.meta('school-course-cursor')??0),course=courses[cursor%Math.max(1,courses.length)],ou=course?.data.source.sourceUrl.match(/(\d+)\/?$/)?.[1],sourceUrls=ou?[course.data.source.sourceUrl,schoolUrl('/d2l/le/content/'+ou+'/Home',config),...['quizzing/user/quizzes_list','dropbox/user/folders_list'].map(p=>schoolUrl('/d2l/lms/'+p+'.d2l?ou='+ou,config))]:[schoolUrl('/d2l/home',config)],job={id:'source-refresh-'+(await digest(body.mutationId)).slice(0,32),type:'school-collect',payload:{provider,expiresAt:Date.now()+86400000,sourceUrls,maxPages:sourceUrls.length,courseId:course?.id??null,courseCursor:cursor},component:'collector',priority:1,authority:'owner-school-refresh'};
   return response(await store.commit({id:v.mutationId(body.mutationId),fingerprint:{path,body},jobs:[job],preconditions:[store.assertion('SELECT NOT EXISTS(SELECT 1 FROM meta WHERE key=?)',['source-refresh-cancel:'+body.mutationId])],extra:[store.sql("INSERT INTO meta VALUES('manual-school-provider',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify((['learn','outlook','careers'].indexOf(provider)+1)%3))],result:{job:{...job,status:'queued',progress:'One course source check is waiting for its collector and quota'}}}));
  }
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
  const kinds={undo:['ticket-spend','presence-correction','devotional','spiritual','devotional-import','task','settings','coop-role'], 'spiritual-complete':['spiritual','devotional','settings'],'devotional-history-correct':['devotional-import'],presence:['presence','settings'],'presence-correct':['presence-correction','settings'],'ticket-spend':['ticket-spend','settings'],'task-progress':['work-session','task'],'prayer-review':['prayer-session'],'notification-read':['notification'],'push-subscribe':['push-subscription'],'push-test':['push-subscription'],backup:[], 'automation-pause':[]}[action];
  if(kinds){if(action==='undo'){const a=await store.sql('SELECT kind FROM audit WHERE id=?',v.identifier(body.auditId)).first();if(a)kinds.push(a.kind);}
   const plan=await loadPlan(store,kinds.length?kinds:['settings'],{auditId:action==='undo'?body.auditId:null}),result=actionResult(action,body,plan,config);
   return response(await commitPlan(store,plan,{id:v.mutationId(body.mutationId),fingerprint:{path,body},result}));
  }
 }
 return null;
}
