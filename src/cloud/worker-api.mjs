import{validateBrief,briefEstimateUpdate}from'../shared/assignment-brief.mjs';
import {readAssistantData} from './assistant-read.mjs';
import {runBudgetedBackground,databaseBudgetStatus} from './database-budget.mjs';
import {prepareStudyInput,completeStudyJob} from './lecture-study.mjs';
import {prepareAssistantInput,completeAssistantJob} from './assistant.mjs';
import {backgroundEnabled,conservingWrites,D1_CONSERVATION_REASON,modelRecheckAt} from './d1-policy.mjs';
import {AppError} from '../shared/errors.mjs';import {digest,CloudStore} from './store.mjs';import {loadPlan,commitPlan} from './records.mjs';import {supportContext,applySupportResult,savePlainJobResult} from '../runtime/support-results.mjs';import {reserveAI,releaseAI,saveQuotaTelemetry} from './quota.mjs';
import {validateCoopDraft} from '../integrations/coop.mjs';
import {boundedBytes} from './files.mjs';
import {publishReleaseCatalogue,validateReleaseCatalogue} from './releases.mjs';
import {ownerAIPairs,jobPairPredicate,aiWorkerTypes} from './job-pairs.mjs';
import {cookingHelpWorkerRoute} from './cooking-help.mjs';
const types={ai:aiWorkerTypes,maintenance:['maintenance','maintenance-release']};
const inputs={'assignment-brief':['task','course','material'],support:['support-thread','support-message','spiritual','devotional','task','settings'],inspire:['task','course','material'], 'coop-draft':['coop-role','coop-profile'],maintenance:['release'],'maintenance-release':['release']};
const unpackJob=r=>({id:r.id,type:r.type,payload:JSON.parse(r.payload),authority:r.authority,attempts:r.attempts,maxAttempts:r.max_attempts});
async function workerIdentity(req,store){const value=req.headers.get('authorization');if(!value?.startsWith('Bearer ')||value.length>200)throw new AppError('Worker authentication required',401);const row=await store.sql('SELECT * FROM worker_credentials WHERE token_hash=? AND revoked=0 AND expires_at>?',await digest(value.slice(7)),Date.now()).first();if(!row||!types[row.component])throw new AppError('Worker authentication denied',401);return {...row,id:row.token_hash};}
export async function workerRoute({req,path,body,store,env,config,metered=false}){
 const identity=await workerIdentity(req,store),component=identity.component,budgetStore=env?.AI_BUDGET?new CloudStore(env.AI_BUDGET):store;
 if(path.startsWith('/api/worker/cooking-')){if(req.method!=='POST')throw new AppError('Method not allowed',405);return cookingHelpWorkerRoute({path,body,store,env,identity});}
 if(!metered&&path==='/api/worker/result')return runBudgetedBackground({...env,DB:env?.DB??store.db},'worker:'+component+'-result',measured=>workerRoute({req,path,body,store:measured,env,config,metered:true}),{essential:true});
 if(req.method!=='POST')throw new AppError('Method not allowed',405);
 const manualAssistantOnly=!backgroundEnabled(env)&&component==='ai'&&body.protocolVersion===2;
 const allowedPairs=manualAssistantOnly?ownerAIPairs:null,pairFilter=allowedPairs?jobPairPredicate(allowedPairs):null;
 if(!backgroundEnabled(env)&&['/api/worker/heartbeat','/api/worker/claim'].includes(path)){const ready=pairFilter&&await store.sql(`SELECT id FROM jobs WHERE component=? AND ${pairFilter.sql} AND (status='running' OR status='queued' AND cancel_requested=0 AND available_at<=?) LIMIT 1`,component,...pairFilter.args,Date.now()).first();if(!ready)return Response.json({ok:true,job:null,backgroundPaused:true,quotaRefreshRequested:component==='ai'?await store.meta('quota-refresh-requested'):null,reason:'Beta background work is paused'});}
 if(path==='/api/worker/wait'){if(component!=='ai'||body.protocolVersion!==2)throw new AppError('Interactive waiting capability denied',403);const deadline=Date.now()+24000;do{if(req.signal.aborted)break;const ready=await store.sql(`SELECT id FROM jobs WHERE component='ai' AND status='queued' AND cancel_requested=0 AND available_at<=?${pairFilter?' AND '+pairFilter.sql:''} ORDER BY priority,created_at LIMIT 1`,Date.now(),...(pairFilter?.args??[])).first();if(ready)return Response.json({ready:true});await new Promise(resolve=>setTimeout(resolve,2000));}while(Date.now()<deadline);return Response.json({ready:false});}
 if(path==='/api/worker/heartbeat'){await store.heartbeat(component,{protocolVersion:body.protocolVersion??1,status:['idle','running','needs-sign-in','offline','failed'].includes(body.status)?body.status:'idle'});return Response.json({ok:true,manualAssistantOnly,quotaRefreshRequested:component==='ai'?await store.meta('quota-refresh-requested'):null});}
 if(path==='/api/worker/release-catalogue'){if(component!=='maintenance')throw new AppError('Release catalogue capability denied',403);return Response.json(await publishReleaseCatalogue(store,body.catalogue,config));}
 if(path==='/api/worker/release-check'){if(component!=='maintenance')throw new AppError('Deployment probe capability denied',403);const asset=body.path;if(typeof asset!=='string'||asset.length>250||!/^\/[A-Za-z0-9_./-]+\.(js|mjs|css|html|svg|json)$/.test(asset)||asset.includes('..')||asset.startsWith('/api/'))throw new AppError('Only a static release asset can be checked');const response=await env.ASSETS.fetch(new Request(config.origin+asset));if(response.status!==200)throw new AppError('Release asset unavailable',404);const bytes=await boundedBytes(response,4_000_000);let marker=null;if(asset==='/_lifeos-release.json')try{const parsed=JSON.parse(new TextDecoder().decode(bytes));if(/^[a-f0-9]{40}$/.test(parsed.commit??''))marker=parsed;}catch{}return Response.json({environment:env.ENVIRONMENT,commit:env.RELEASE_COMMIT,sha256:await digest(bytes),bytes:bytes.length,marker});}
 if(['quota','admit','usage'].some(x=>path==='/api/worker/'+x)&&env?.ENVIRONMENT&&!env.AI_BUDGET)throw new AppError('The shared LifeOS quota gate is unavailable',503,'quota_unavailable');
 if(path==='/api/worker/quota'){
  if(!['ai','maintenance'].includes(component))throw new AppError('Capability denied',403);
  const t=body.telemetry;if(t?.authentication!=='chatgpt'||!Number.isFinite(t.checkedAt)||Math.abs(Date.now()-t.checkedAt)>120000||!t.limits||!Array.isArray(t.models)||t.models.length>100)throw new AppError('Invalid quota telemetry');
  await saveQuotaTelemetry(budgetStore,t);return Response.json({ok:true});
 }
 if(path==='/api/worker/claim'){
  if(await conservingWrites(store))return Response.json({job:null,reason:D1_CONSERVATION_REASON});
  if(component==='maintenance'&&(await store.meta('maintenancePaused')||await store.meta('automationPaused')))return Response.json({job:null,reason:'maintenance paused'});
  const claimToken=crypto.randomUUID(),owner=identity.id+':'+claimToken;
  const row=await store.claim(component,owner,{allowedPairs,types:allowedPairs?allowedPairs.map(([type])=>type):component==='maintenance'&&env.ENVIRONMENT==='beta'?['maintenance']:component==='ai'&&body.protocolVersion!==2?types.ai.filter(t=>!['assistant','lecture-study','assignment-brief'].includes(t)):types[component]});if(!row)return Response.json({job:null});const job=unpackJob(row);

  if(job.type==='lecture-study'){try{const input=await prepareStudyInput({store,job,claimToken,owner});return Response.json(input?{job,input,claimToken}:{job:null});}catch(error){if(['course_policy','stale_result'].includes(error.code)||error.status>=400&&error.status<500){await store.sql("UPDATE jobs SET status='needs-input',error=?,progress=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?",error.message,error.message,job.id,owner).run();return Response.json({job:null});}throw error;}}
  if(job.type==='assistant'){try{const input=await prepareAssistantInput({store,job,claimToken,owner,config,env});return Response.json(input?{job:input.job,input,claimToken}:{job:null});}catch(error){if(error.code==='course_policy'){await store.sql("UPDATE jobs SET status='needs-input',error=?,progress=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?",error.message,error.message,job.id,owner).run();return Response.json({job:null});}throw error;}}

  const plan=await loadPlan(store,[...inputs[job.type],'job-input']);
  let records=[];
  if(job.type==='support'){const thread=plan.get('support-thread',job.payload.threadId),message=plan.get('support-message',job.payload.messageId);records=[thread,message].filter(Boolean);const context=supportContext({store:plan,job});for(const key of Object.keys(context.versions)){const split=key.indexOf(':'),r=plan.get(key.slice(0,split),key.slice(split+1));if(r)records.push(r);}job.context=context;}
  else if(['inspire','assignment-brief'].includes(job.type)){const task=plan.get('task',job.payload.taskId);if(task){records.push(task);const course=task.data.courseId?plan.get('course',task.data.courseId):null;if(course)records.push(course);if(job.payload.purpose==='assignment-brief'){for(const source of job.payload.sources??[]){if(source.id===task.id)continue;const material=plan.get('material',source.id);if(!material||material.version!==source.version)throw new AppError('Assignment source changed. Open the brief again.',409,'stale_result');records.push(material);}}}}
  else if(job.type==='coop-draft')records=[plan.get('coop-role',job.payload.roleId),plan.get('coop-profile','owner')].filter(Boolean);
  else records=inputs[job.type].flatMap(k=>plan.list(k));

  const input={job,records,revisions:records.map(r=>({kind:r.kind,id:r.id,version:r.version})),capturedAt:Date.now(),claimToken};
  plan.put('job-input',job.id,input,plan.get('job-input',job.id)?.version??0,{actor:'worker-dispatch'});
  await commitPlan(store,plan,{id:'job-input-'+job.id+'-'+claimToken,fingerprint:{jobId:job.id,claimToken},result:{captured:true},extra:[store.leaseAssertion(job.id,owner)]});
  return Response.json({job,input,claimToken});
 }
 const jobId=body.jobId;if(typeof jobId!=='string'||jobId.length>100)throw new AppError('Job identifier required');
 if(typeof body.claimToken!=='string'||!/^[a-f0-9-]{36}$/.test(body.claimToken))throw new AppError('Claim token required',409,'lease_lost');const owner=identity.id+':'+body.claimToken;
 const row=await store.sql('SELECT * FROM jobs WHERE id=?',jobId).first();if(!row||row.component!==component)throw new AppError('Job not found',404);
 if(row.type==='cooking-help')throw new AppError('Use the original local cooking request protocol.',403,'cooking_help_denied');
 if(path==='/api/worker/result'&&row.status==='completed')return Response.json({completed:true,duplicate:true});
 if(row.status!=='running'||row.lease_owner!==owner||row.lease_until<=Date.now()||row.cancel_requested)throw new AppError('Job lease is no longer active',409,'lease_lost');
 if(path==='/api/worker/assistant-read'){if(component!=='ai'||row.type!=='assistant'||body.tool!=='lifeos_read')throw new AppError('Source capability denied',403);return Response.json(await readAssistantData({store,jobId,args:body.args}));}
 if(path==='/api/worker/progress'){if(component!=='ai'||row.type!=='assistant')throw new AppError('Reply streaming capability denied',403);if(body.activity!=null&&(typeof body.activity!=='string'||body.activity.length>1600)||typeof body.reply!=='string'||body.reply.length>18000||!Number.isInteger(body.sequence)||body.sequence<1||body.sequence>500)throw new AppError('Invalid partial reply');const thread=JSON.parse(row.payload).threadId;await store.db.batch([store.leaseAssertion(jobId,owner),store.sql("INSERT INTO ai_reply_stream VALUES(?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET lease_owner=excluded.lease_owner,sequence=excluded.sequence,reply=excluded.reply,updated_at=excluded.updated_at WHERE ai_reply_stream.lease_owner!=excluded.lease_owner OR ai_reply_stream.sequence<excluded.sequence",jobId,thread,owner,body.sequence,body.reply,Date.now()),...(body.activity?[store.sql('UPDATE jobs SET progress=? WHERE id=? AND lease_owner=?',body.activity,jobId,owner)]:[]),store.sql('DELETE FROM assertions')]);return Response.json({saved:true});}
 if(path==='/api/worker/lease'){const now=Date.now(),changed=await store.sql("UPDATE jobs SET lease_until=?,updated_at=? WHERE id=? AND lease_owner=? AND status='running' AND lease_until>? AND cancel_requested=0 RETURNING id",now+60000,now,jobId,owner,now).all();if(changed.results.length!==1)throw new AppError('Job lease is no longer active',409,'lease_lost');return Response.json({active:true});}
 if(path==='/api/worker/release-backup'){
  const payload=JSON.parse(row.payload);if(component!=='maintenance'||row.type!=='maintenance-release'||row.authority!=='authenticated-release-action'||payload.intentional!==true||env.ENVIRONMENT!=='production')throw new AppError('Intentional production release capability required',403);
  if(payload.action==='deploy-beta')return Response.json({evidence:null});const id='release-backup-'+row.id,backup=await store.sql('SELECT * FROM jobs WHERE id=?',id).first();if(!backup)await store.commit({id:'enqueue-'+id,fingerprint:{releaseJob:row.id},jobs:[{id,type:'backup',payload:{},component:'cloud',priority:1,authority:'intentional-release-backup'}],result:{queued:true}});
  if(backup?.status==='completed'){const state=await store.meta('backup:'+id);if(!state?.complete||!state.manifest?.verified)throw new AppError('Release backup is not verified',409);return Response.json({evidence:{verified:true,backupId:id,sha256:state.manifest.sha256}});}if(backup?.status==='failed')throw new AppError('Release backup failed; production is preserved',409);await store.defer(row.id,owner,'Waiting for a verified cloud backup',Date.now()+60000);return Response.json({deferred:true});
 }
 if(path==='/api/worker/admit'){
  const job=unpackJob(row),grant=await reserveAI(store,job,{needsTools:component==='maintenance',needsImages:false,budgetStore,scope:config?.origin??'local-test'});if(!grant.allowed)await store.defer(job.id,owner,grant.reason,modelRecheckAt(grant));return Response.json(grant);
 }
 if(path==='/api/worker/usage'){const reservation=await budgetStore.sql('SELECT budget FROM ai_reservations WHERE id=?',body.reservationId).first();if(!reservation||JSON.parse(reservation.budget).jobId!==jobId||JSON.parse(reservation.budget).scope!==(config?.origin??'local-test'))throw new AppError('Reservation does not match job',403);return Response.json(await releaseAI(budgetStore,body.reservationId,body.telemetry,body.status));}
 if(path==='/api/worker/fail'){
  const busy=body.retryDeferred===true,defer=body.quotaDeferred===true||busy,status=body.needsSignIn?'needs-input':body.permanent===true&&['assignment-brief','assistant'].includes(row.type)||row.attempts>=row.max_attempts?'failed':'queued',now=Date.now();
  const error=String(body.error??'Worker failed').slice(0,300),progress=busy?'Waiting for the current LifeOS AI job':defer?'waiting for a current quota check':null;
  const update=store.sql("UPDATE jobs SET status=?,error=?,progress=?,available_at=?,attempts=MAX(0,attempts-?),lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_owner=? AND status='running' AND lease_until>? AND cancel_requested=0 RETURNING id",defer?'queued':status,error,progress,now+(busy?5000:defer?15*60000:Math.min(3600000,30000*2**row.attempts)),defer?1:0,now,jobId,owner,now);
  if((await update.all()).results.length!==1)throw new AppError('Job lease is no longer active',409,'lease_lost');
  return Response.json({saved:true});
 }
 if(path==='/api/worker/result'){
  const job=unpackJob(row);const saved=await store.get('job-input',job.id);if(!saved||saved.data.claimToken!==body.claimToken)throw new AppError('Job input does not match this claim',409,'stale_result');
  if(job.type==='lecture-study')return Response.json(await completeStudyJob({store,job,input:saved,response:body.response,owner}));
  if(job.type==='assistant')return Response.json(await completeAssistantJob({store,job,input:saved,response:body.response,owner,config}));
  const kinds=['job-result','job-input','assignment-brief',...(job.type==='coop-draft'?['coop-draft']:[]),...inputs[job.type]],plan=await loadPlan(store,kinds);let result;
  if(job.type==='support')result=applySupportResult({store:plan,job,response:body.response,context:saved.data.job.context});
  else if(['inspire','assignment-brief'].includes(job.type)){
   if(saved.data.revisions.some(r=>plan.get(r.kind,r.id)?.version!==r.version))throw new AppError('Task changed while processing',409,'stale_result');
   if(job.payload.purpose==='assignment-brief'){const brief=validateBrief(body.response?.result,job.payload.sources),task=plan.get('task',job.payload.taskId);plan.put('assignment-brief',task.id,{...brief,taskId:task.id,sourceHash:job.payload.sourceHash,generatedAt:new Date().toISOString()},plan.get('assignment-brief',task.id)?.version??0,{actor:'assignment-instruction-brief'});const estimate=briefEstimateUpdate(task.data,brief);if(estimate!==task.data)plan.put('task',task.id,estimate,task.version,{actor:'assignment-planning-estimate'});result=savePlainJobResult({store:plan,job,result:{reply:'Assignment outline ready',taskId:task.id}});}
   else {const out=body.response?.result;if(typeof out?.reply!=='string'||out.reply.length>30000||typeof out.needsInput!=='boolean'||!Array.isArray(out.corrections)||out.corrections.length)throw new AppError('Invalid Inspire response');
   result=savePlainJobResult({store:plan,job,result:{reply:out.reply,needsInput:out.needsInput,corrections:[],threadId:null}});}
  }else if(job.type==='coop-draft'){
   if(saved.data.revisions.some(r=>plan.get(r.kind,r.id)?.version!==r.version))throw new AppError('Co-op sources changed during processing',409,'stale_result');
   const role=plan.get('coop-role',job.payload.roleId),profile=plan.get('coop-profile','owner'),validated=validateCoopDraft(body.response?.result,{role,profile});
   plan.put('coop-draft',job.id,{...validated,roleId:role.id,roleVersion:role.version,profileId:profile.id,profileVersion:profile.version,createdAt:new Date().toISOString(),sourceJobId:job.id,staleSource:false},0,{actor:'coop-draft-runtime'});
   result=savePlainJobResult({store:plan,job,result:{draftId:job.id,roleId:role.id,reply:'Source-backed draft material is ready for your review.',needsInput:false,needsReview:true,submitted:false}});
  }else if(component==='maintenance'){
   const output=body.response?.result,catalogue=output?.catalogue;if(!output||!catalogue||JSON.stringify(output).length>100000||!Array.isArray(catalogue.releases)||catalogue.releases.length>20||!Array.isArray(catalogue.history)||catalogue.history.length>20||!catalogue.current)throw new AppError('Bounded maintenance receipt required');
   for(const release of catalogue.releases)if(!/^beta-[a-f0-9]{16}$/.test(release.releaseId??'')||!/^[a-f0-9]{40}$/.test(release.commit??'')||release.dataMigration!=='none'||release.tests?.targeted!=='passed'||release.tests?.suite!=='passed'||typeof release.summary!=='string'||release.summary.length>3000)throw new AppError('Invalid tested release receipt');
   for(const key of ['beta','production'])if(catalogue.current[key]!==null&&!catalogue.releases.some(r=>r.releaseId===catalogue.current[key]))throw new AppError('Unknown current release');
   validateReleaseCatalogue(catalogue);const {catalogue:ignored,...summary}=output;result=savePlainJobResult({store:plan,job,result:summary});
  }else throw new AppError('This result adapter is not ready for cutover',503,'adapter_unavailable');
  const extra=[store.leaseAssertion(job.id,owner),store.assertion('SELECT version=? FROM records WHERE kind=\'job-input\' AND id=?',[saved.version,job.id]),store.sql("UPDATE jobs SET status='completed',result=?,updated_at=?,lease_owner=NULL,lease_until=NULL,error=NULL WHERE id=?",JSON.stringify(result),Date.now(),job.id)];
  return Response.json(await commitPlan(store,plan,{id:'job-result-'+job.id,fingerprint:{jobId:job.id},result:{completed:true},extra}));
 }
 throw new AppError('Worker operation not found',404);
}
