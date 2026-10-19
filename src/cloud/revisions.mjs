import {AppError} from '../shared/errors.mjs';
import * as v from '../server/validation.mjs';
import {loadPlan,commitPlan} from './records.mjs';
import {syncDevotional} from '../shared/application.mjs';
import {digest} from './store.mjs';

const fields={'private-journal':['title','answers','templateName'],'private-note':['title','text','document'],devotional:['points','customText','type','bookId','chapter','chapterEnd','passage'],coursework:['title','text','document','language','notes'],'prayer-list':['sections'],'prayer-note':['title','text','nodes','notes','people'],task:['title','nextAction','nextStep','nextStepMinutes','notes','remainingMinutes','estimatedMinutes'],project:['title','notes']};
const pick=(data,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(data,k)).map(k=>[k,data[k]]));
export function restoredContent(kind,current,previous,sectionId){
 if(!fields[kind])throw new AppError('Version recovery is unavailable for this record',404);
 if(kind==='prayer-list'){
  if(!sectionId)throw new AppError('Choose one prayer section to restore');
  const section=previous.sections?.find(s=>s.id===sectionId);
  if(!section||!current.sections?.some(s=>s.id===sectionId))throw new AppError('Section not found',404);
  return {...current,...v.recordData(kind,{sections:current.sections.map(s=>s.id===sectionId?structuredClone(section):s)})};
 }
 const next={...current,...pick(previous,fields[kind])};
 // Restoring words cannot recreate approvals, submissions, timestamps or source evidence.
 if(kind==='coursework'&&!previous.document)delete next.document;
 if(kind==='devotional'){
  const complete=current.complete===true&&(next.type==='custom'?!!next.customText?.trim():next.points?.length===7&&next.points.every(p=>p.trim()));
  if(current.complete===true&&!complete)throw new AppError('That earlier version is unfinished. Copy the words you need from the preview into the editor; the completed entry has not changed.',409,'unfinished_recovery');
  const clean=v.devotional({...next,complete,version:1,archiveRequested:false});
  return {...next,...clean,complete,archiveRequested:false,archiveStatus:'not-requested',...(complete?{}:{completedAt:null})};
 }
 if(!['task','private-journal','private-note'].includes(kind))v.recordData(kind,pick(next,fields[kind]));
 return next;
}
export async function revisionRoute({store,req,path,body}){
 const match=path.match(/^\/api\/revisions\/([-\w]+)\/([-\w]+)$/);if(!match)return null;
 const [,kind,id]=match;if(!fields[kind])throw new AppError('Not found',404);v.identifier(id);
 if(req.method==='GET'){
  const before=Number(new URL(req.url).searchParams.get('before')||Number.MAX_SAFE_INTEGER);v.version(before);
  const current=await store.get(kind,id);if(!current)throw new AppError('Record not found',404);
  const rows=(await store.sql('SELECT id,after_json,created_at FROM audit WHERE kind=? AND record_id=? AND CAST(json_extract(after_json,\'$.version\') AS INTEGER)<? ORDER BY CAST(json_extract(after_json,\'$.version\') AS INTEGER) DESC LIMIT 21',kind,id,before).all()).results;
  return Response.json({current,items:rows.slice(0,20).map(r=>({id:r.id,at:r.created_at,version:JSON.parse(r.after_json).version,data:pick(JSON.parse(r.after_json).data,fields[kind])})),next:rows.length>20?JSON.parse(rows[19].after_json).version:null});
 }
 if(req.method!=='POST')throw new AppError('Method not allowed',405);
 v.exactFields(body,['mutationId','version','auditId','sectionId']);v.identifier(body.auditId);v.version(body.version);
 const previous=await store.mutation(v.mutationId(body.mutationId),await digest(JSON.stringify({path,body})));if(previous)return Response.json(previous);
 const row=await store.sql('SELECT after_json FROM audit WHERE id=? AND kind=? AND record_id=?',body.auditId,kind,id).first();if(!row)throw new AppError('Version not found',404);
 const plan=await loadPlan(store,[kind,...(kind==='devotional'?['spiritual']:[])]),current=plan.get(kind,id);
 if(!current||current.version!==body.version)throw new AppError('This record changed. Review the latest version before restoring.',409);
 const data=restoredContent(kind,current.data,JSON.parse(row.after_json).data,body.sectionId);
 if(kind.startsWith('private-'))delete data.recovery;else data.recovery={fromAuditId:body.auditId,at:new Date().toISOString(),...(body.sectionId?{sectionId:body.sectionId}:{})};
 const item=plan.put(kind,id,data,body.version,{actor:'owner-version-recovery'});if(kind==='devotional')syncDevotional(plan,item);
 const extra=[];
 return Response.json(await commitPlan(store,plan,{id:v.mutationId(body.mutationId),fingerprint:{path,body},extra,result:{item}}));
}
