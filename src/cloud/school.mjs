import {mergeAssessmentSources} from '../../public/academic-coverage.js';
import {normalizeSubmissionEvidence,matchSubmittedTask,applySubmissionReceipt} from '../integrations/school-submissions.mjs';
import {normalizeRuntimeCatalogue,mergeRuntimeCatalogue} from '../integrations/school-runtime.mjs';import {normalizeRuntimeContent} from '../integrations/school-content.mjs';import {normalizePortalResponse,mergePortalRecord} from '../integrations/portal-runtime.mjs';import {hash} from '../shared/hash.mjs';import {sourceDelta} from '../shared/school-delta.mjs';import {loadPlan,commitPlan} from './records.mjs';import {AppError} from '../shared/errors.mjs';
export function validateCollectedSource(response,{provider,courses,now,configuration={}}){
 if(!response?.browserReadVerified||!response.raw||JSON.stringify(response.raw).length>700000)throw new AppError('Verified bounded browser evidence is required');
 const policies=Object.fromEntries(courses.map(c=>[c.data.source?.sourceId,c.data.policy??{status:'unknown'}]));
 if(provider!=='learn')return normalizePortalResponse(response.raw,{provider,retrievedAt:now,timeZone:'America/Toronto',configuration});
 if(response.raw.status==='BLOCKED')return {status:'blocked',records:[],reason:String(response.raw.blockers?.[0]??'School sign-in or source access is required').slice(0,500)};
 try{
 const options={retrievedAt:now,trustedPolicies:policies,timeZone:'America/Toronto',configuration},catalogue=normalizeRuntimeCatalogue(response.raw,options),map=new Map(catalogue.records.map(r=>[r.kind+':'+r.id,r])),sourceBlockers=[],contentObservations=[];
 const addRecord=r=>{const previous=map.get(r.kind+':'+r.id);if(r.kind==='course'){r.data.assessmentSources=mergeAssessmentSources(previous?.data.assessmentSources,r.data.assessmentSources);if(previous?.data.policyEvidence&&!r.data.policyEvidence)r.data.policyEvidence=previous.data.policyEvidence;}map.set(r.kind+':'+r.id,r);};
 for(const page of response.raw.pages){
  const path=new URL(page.url).pathname;
  try{const content=normalizeRuntimeContent([page],options);for(const record of content.records)addRecord(record);sourceBlockers.push(...content.blockers);contentObservations.push(...content.contentObservations);}
  catch(error){sourceBlockers.push(`Source page ${path} needs review: ${String(error.message).slice(0,180)}`);}
  try{for(const record of normalizeSubmissionEvidence([page],{retrievedAt:now,configuration}))addRecord(record);}
  catch(error){sourceBlockers.push(`Assessment page ${path} needs review: ${String(error.message).slice(0,180)}`);}
 }
 if(map.size>100)throw new AppError('School catalogue requires a smaller slice');const blockers=[...new Set([...catalogue.blockers,...sourceBlockers])],conflict=blockers.find(s=>/\b(?:deadline|due|extension)\b/i.test(s)&&/\b(?:conflict|disagree\w*|differences|unresolved)\b/i.test(s)&&!courses.some(c=>map.has('course:'+c.id)&&(c.data.assessmentSources??[]).some(a=>a.kind==='deadline-conflict'&&a.status==='resolved'&&a.resolution?.evidenceUrls?.length&&a.resolution.conflictReason===s)));if(conflict){for(const r of map.values())if(r.kind==='course')r.data.assessmentSources=mergeAssessmentSources(r.data.assessmentSources,[{title:'Deadline evidence',kind:'deadline-conflict',url:r.data.source.sourceUrl,status:'unverified',lastVerifiedAt:null,discoveredAt:now,reason:conflict.slice(0,500)}]);}return {status:'collected',records:[...map.values()].filter(r=>!conflict||r.kind!=='task'),coverage:conflict?'requires-review':contentObservations.some(o=>o.coverage==='full-text')?'bounded-source-text':'partial',reason:conflict??null,blockers};
 }catch(error){return {status:'blocked',records:[],reason:'The source read needs validation repair: '+String(error.message).slice(0,250)};}
}
export function canonicalSchoolTask(incoming,tasks){
 if(incoming.kind!=='task'||tasks.some(t=>t.id===incoming.id))return incoming;
 const aliases=tasks.filter(t=>t.data.courseId===incoming.data.courseId&&(t.data.verifiedSourceAliases??[]).some(a=>a.url===incoming.data.source?.sourceUrl&&a.title===incoming.data.title));
 if(aliases.length===1){const existing=aliases[0];return {...incoming,id:existing.id,data:{...(!incoming.data.dueEvidence&&existing.data.dueEvidence?existing.data:incoming.data),title:existing.data.title,latestSourceObservation:{source:incoming.data.source,quote:incoming.data.notes??null}}};}
 const title=s=>String(s??'').toLowerCase().replace(/^[a-z]{2,8}\s*\d{3}[a-z]?\s*[-:]?\s*/i,'').replace(/\s+/g,' ').trim();
 const matches=tasks.filter(t=>t.data.courseId===incoming.data.courseId&&title(t.data.title)===title(incoming.data.title)&&t.data.source?.sourceUrl===incoming.data.source?.sourceUrl);
 return matches.length===1?{...incoming,id:matches[0].id}:incoming;
}
export async function reconcileSchoolSlice({store,job,config={}}){
 const batch=await store.get('school-batch',job.payload.batchId);if(!batch)throw new AppError('School batch unavailable',404);if(batch.data.complete)return {complete:true,duplicate:true};
 const data=batch.data,index=data.cursor??0,rows=data.records.slice(index,index+3),plan=await loadPlan(store,['school-batch','course','material','task','coop-role','school-source','integration','school-submission']);let changed=0;
 for(const row of rows){const incoming=canonicalSchoolTask(row,plan.list('task'));
 if(['task','coop-role'].includes(incoming.kind)&&await store.sql('SELECT 1 FROM retired_records WHERE kind=? AND id=?',incoming.kind,incoming.id).first())continue;
 if(incoming.kind==='school-submission'){
  const before=plan.get('school-submission',incoming.id),task=matchSubmittedTask(incoming,plan.list('task'),config);
  if(before?.data.evidenceHash!==incoming.data.evidenceHash)plan.put('school-submission',incoming.id,{...incoming.data,matchedTaskId:task?.id??null},before?.version??0,{actor:'verified-school-receipt'});
  if(task){const data=applySubmissionReceipt(task,incoming);if(hash(data)!==hash(task.data)){plan.put('task',task.id,data,task.version,{actor:'verified-school-submission'});changed++;}}
  continue;
 }
 if(!['course','material','task','coop-role'].includes(incoming.kind))throw new AppError('Unsupported school record');const before=plan.get(incoming.kind,incoming.id),merged=data.provider==='learn'?mergeRuntimeCatalogue(before,incoming):mergePortalRecord(before,incoming);if(before&&hash(before.data)===hash(merged.data))continue;
  // Trusted course policy is never replaced by a model interpretation.
  if(incoming.kind==='course'){if(before?.data.policy)merged.data.policy=before.data.policy;merged.data.assessmentSources=mergeAssessmentSources(before?.data.assessmentSources,incoming.data.assessmentSources);}
  if(incoming.kind==='task'){const receipt=plan.list('school-submission').filter(r=>r.data.courseId===merged.data.courseId).find(r=>matchSubmittedTask(r,[...plan.list('task').filter(t=>t.id!==merged.id),merged],config)?.id===merged.id);if(receipt)merged.data=applySubmissionReceipt(merged,receipt);}
  plan.put(incoming.kind,incoming.id,merged.data,before?.version??0,{actor:'school-source-reconcile'});changed++;
  if(incoming.kind==='material'&&typeof merged.data.text==='string'){const sid='source-'+hash(incoming.id).slice(0,32),old=plan.get('school-source',sid),delta=sourceDelta(old?.data,{id:sid,url:merged.data.source?.sourceUrl??merged.data.url,title:merged.data.title,text:merged.data.text,status:merged.data.source?.coverage==='full-text'?'complete':'partial',retrievedAt:data.collectedAt,courseId:merged.data.courseId,locator:merged.data.source?.locator},new Date().toISOString(),config);delta.source.provider=data.provider;plan.put('school-source',sid,delta.source,old?.version??0,{actor:'school-change-detection'});if(delta.interpret&&data.coverage!=='requires-review')plan.enqueue('school-interpretation',{sourceId:sid,sourceHash:delta.source.contentHash},{priority:1,authority:'changed-school-source'});}
 }
 const complete=index+rows.length>=data.records.length;plan.put('school-batch',batch.id,{...data,cursor:index+rows.length,complete},batch.version,{actor:'school-source-reconcile'});
 if(complete){const old=plan.get('integration',data.provider);plan.put('integration',data.provider,{...old?.data,provider:data.provider,status:data.status==='blocked'?'blocked':data.coverage??'partial',lastAttempt:data.collectedAt,...(data.status!=='blocked'?{lastCollectionAt:data.collectedAt,lastSourceReadAt:data.collectedAt}:{}),coverage:data.coverage??'blocked',reason:data.reason??null,sourceGaps:data.blockers??[],modelDependent:true},old?.version??0,{actor:'school-coverage'});}
 await commitPlan(store,plan,{id:'school-slice-'+job.id+'-'+index,fingerprint:{batchId:batch.id,index},extra:complete&&data.provider==='learn'&&data.status!=='blocked'&&!data.continuation&&Number.isInteger(data.courseCursor)?[store.sql("INSERT INTO meta VALUES('school-course-cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify((data.courseCursor??0)+1))]:[],result:{complete,changed}});return {complete,changed};
}
