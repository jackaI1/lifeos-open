import{assignmentBriefRoute}from'./assignment-brief.mjs';
import * as v from '../server/validation.mjs';import {AppError} from '../shared/errors.mjs';import {loadPlan,commitPlan} from './records.mjs';import {digest} from './store.mjs';import {validateDependencies,learnedEffort} from '../domain/planning-insights.mjs';
export async function taskToolsRoute({store,req,path,body}){
 const brief=await assignmentBriefRoute({store,req,path,body});if(brief)return brief;
 const match=path.match(/^\/api\/task-tools\/([-\w]+)$/);if(!match)return null;const id=v.identifier(match[1]),task=await store.get('task',id);if(!task)throw new AppError('Task not found',404);
 if(req.method==='GET'){
  const tasks=await store.list('task'),work=await store.list('work-session'),course=task.data.courseId?await store.get('course',task.data.courseId):null;
  return Response.json({task,effort:learnedEffort({...task.data,id},tasks.map(t=>({...t.data,id:t.id})),work.map(w=>w.data)),receipt:task.data.submissionEvidence??(task.data.completionEvidence?{authority:'owner-confirmed',workSessionId:task.data.completionEvidence,at:task.data.progressEvidence?.find(e=>e.id===task.data.completionEvidence)?.at}:null),policy:course?.data.policy??task.data.policy??null});
 }
 if(req.method!=='POST')throw new AppError('Method not allowed',405);
 v.exactFields(body,['mutationId','version','operation','dependencies','changeId','decision','checklist','dueDate','difficulty','estimatedMinutes']);v.version(body.version);
 const prior=await store.mutation(v.mutationId(body.mutationId),await digest(JSON.stringify({path,body})));if(prior)return Response.json(prior);
 const plan=await loadPlan(store,['task','material','coursework']),current=plan.get('task',id);if(current.version!==body.version)throw new AppError('Task changed. Review its current version.',409);let data={...current.data};
 if(body.operation==='planning'){if(body.dueDate){data.dueDate=v.date(body.dueDate);delete data.dueAt;}else{delete data.dueDate;delete data.dueAt;}v.number(body.difficulty,1,5);v.number(body.estimatedMinutes,0,100000);data.difficulty=body.difficulty;data.estimatedMinutes=body.estimatedMinutes;data.remainingMinutes=body.estimatedMinutes;}
 else if(body.operation==='dependencies'){try{data.dependencies=validateDependencies(id,body.dependencies,plan.list('task').map(t=>({...t.data,id:t.id})));}catch(e){throw new AppError(e.message);}}
 else if(body.operation==='deadline-review'){
  v.enumValue(body.decision,['reviewed','keep-current','accept-source']);
  if(body.changeId==='conflict'){if(!data.deadlineConflict)throw new AppError('Deadline conflict changed',409);const c=data.deadlineConflict;if(body.decision==='accept-source'){data.dueDate=v.date(c.proposed);delete data.dueAt;}data.deadlineReview={...c,decision:body.decision,at:new Date().toISOString()};delete data.deadlineConflict;}
  else {const change=data.deadlineChanges?.find(c=>c.id===body.changeId);if(!change)throw new AppError('Deadline change not found',404);data.deadlineChanges=data.deadlineChanges.map(c=>c.id===change.id?{...c,reviewedAt:new Date().toISOString()}:c);}
 }
 else if(body.operation==='rubric'){
  if(!Array.isArray(body.checklist)||body.checklist.length>40)throw new AppError('Use at most forty rubric requirements');const seen=new Set();
  data.rubricChecklist=body.checklist.map(r=>{v.exactFields(r,['id','label','sourceId','sourceQuote','draftId','draftQuote','checked']);v.identifier(r.id);if(seen.has(r.id))throw new AppError('Duplicate requirement');seen.add(r.id);v.text(r.label,1000,{required:true});v.boolean(r.checked);v.identifier(r.sourceId);v.text(r.sourceQuote,3000,{required:true});const material=plan.get('material',r.sourceId);if(!material||material.data.courseId!==data.courseId||!(material.data.text??'').includes(r.sourceQuote))throw new AppError('The requirement must quote a saved source for this course');if(r.draftId){v.identifier(r.draftId);v.text(r.draftQuote,3000,{required:true});const draft=plan.get('coursework',r.draftId);if(draft?.data.taskId!==id||!draft.data.text?.includes(r.draftQuote))throw new AppError('The selected draft no longer contains that evidence');return {...r,draftVersion:draft.version,sourceVersion:material.version,authority:'owner-mapped'};}return {...r,sourceVersion:material.version,authority:'owner-checked'};});
 }else throw new AppError('Unsupported task action');
 const item=plan.put('task',id,data,current.version,{actor:'owner-task-tools'});return Response.json(await commitPlan(store,plan,{id:body.mutationId,fingerprint:{path,body},result:{item}}));
}
