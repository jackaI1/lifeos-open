import {prayerDatesRoute} from './prayer-dates.mjs';
import {stepSources} from '../../public/spiritual-tools.js';import * as v from '../server/validation.mjs';import {AppError} from '../shared/errors.mjs';import {digest} from './store.mjs';
const change=(kind,id,before,data)=>{const now=new Date().toISOString();return {kind,id,before,after:{kind,id,data,version:(before?.version??0)+1,createdAt:before?.createdAt??now,updatedAt:now},auditId:crypto.randomUUID(),actor:'owner-spiritual-tools'};};
export async function stepCorrections(store,entryIds){const ids=[...new Set(entryIds)].filter(Boolean).slice(0,5),keys=await Promise.all(ids.flatMap(id=>['4-0','4-1','5-0','5-1'].map(key=>digest(id+':'+key))));if(!keys.length)return [];return (await store.sql("SELECT * FROM records WHERE kind='devotional-step' AND id IN ("+keys.map(()=>'?').join(',')+")",...keys).all()).results.map(r=>({id:r.id,kind:r.kind,data:JSON.parse(r.data),version:r.version,createdAt:r.created_at,updatedAt:r.updated_at}));}
export async function spiritualToolsRoute({store,req,path,body}){
 const dates=await prayerDatesRoute({store,req,path,body});if(dates)return dates;
 if(path==='/api/devotional-step'&&req.method==='GET'){const ids=new URL(req.url).searchParams.getAll('entryId');if(ids.length>2)throw new AppError('Choose at most two entries');ids.forEach(v.identifier);return Response.json({items:await stepCorrections(store,ids)});}
 if(path==='/api/prayer-answers'&&req.method==='GET')return Response.json({items:await store.list('prayer-answer',{limit:200})});
 if(!['/api/devotional-step','/api/prayer-answers'].includes(path)||req.method!=='POST')return null;
 const fingerprint={path,body},prior=await store.mutation(v.mutationId(body.mutationId),await digest(JSON.stringify(fingerprint)));if(prior)return Response.json(prior);let item,reads=[],changes=[];
 if(path==='/api/devotional-step'){
  v.exactFields(body,body.steps?['mutationId','entryId','entryVersion','steps']:['mutationId','entryId','entryVersion','key','original','corrected','version']);v.identifier(body.entryId);v.version(body.entryVersion);
  const entry=await store.get('devotional',body.entryId);if(!entry||entry.version!==body.entryVersion)throw new AppError('The devotional changed. Reopen its applications.',409);
  const sources=stepSources(entry.data),steps=body.steps??[{key:body.key,original:body.original,corrected:body.corrected,version:body.version}];if(!Array.isArray(steps)||!steps.length||steps.length>4||new Set(steps.map(s=>s.key)).size!==steps.length)throw new AppError('Choose distinct authored Small Steps');
  for(const step of steps){v.exactFields(step,['key','original','corrected','version']);v.version(step.version);v.text(step.corrected,1000,{required:true});const source=sources.find(s=>s.key===step.key&&s.original===step.original);if(!source)throw new AppError('This Small Step no longer matches the devotional.',409);const id=await digest(entry.id+':'+step.key),old=await store.get('devotional-step',id);if((old?.version??0)!==step.version)throw new AppError('Application correction changed',409);changes.push(change('devotional-step',id,old,{entryId:entry.id,entryVersion:entry.version,...source,corrected:step.corrected,correctedAt:new Date().toISOString()}));}
  item=changes[0];reads.push({kind:entry.kind,id:entry.id,version:entry.version});
 }else{
  v.exactFields(body,['mutationId','id','version','requestId','sessionId','text','answeredOn','archived']);v.identifier(body.id);v.identifier(body.requestId);v.version(body.version);v.text(body.text,3000,{required:true});v.date(body.answeredOn);if(body.archived!==undefined)v.boolean(body.archived);
  const lists=await store.list('prayer-list',{limit:5}),{flattenPrayer}=await import('../../public/prayer-tree.js'),list=lists.find(r=>r.data.sections?.some(s=>flattenPrayer(s.nodes).some(n=>n.id===body.requestId)));if(!list)throw new AppError('Choose an existing prayer request');reads.push({kind:list.kind,id:list.id,version:list.version});
  if(body.sessionId){v.identifier(body.sessionId);const session=await store.get('prayer-session',body.sessionId);if(!session)throw new AppError('Prayer session not found');reads.push({kind:session.kind,id:session.id,version:session.version});}
  const old=await store.get('prayer-answer',body.id);if((old?.version??0)!==body.version)throw new AppError('This answer changed',409);item=change('prayer-answer',body.id,old,{requestId:body.requestId,sessionId:body.sessionId??null,text:body.text,answeredOn:body.answeredOn,archived:body.archived??false,authority:'owner-confirmed'});
 }
 return Response.json(await store.commit({id:body.mutationId,fingerprint,reads,changes:changes.length?changes:[item],result:{item:item.after,items:(changes.length?changes:[item]).map(c=>c.after)}}));
}
