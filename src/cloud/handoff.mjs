import {prepareHandoff,validateHandoffReturn} from '../shared/handoff.mjs';import {loadPlan,commitPlan} from './records.mjs';import {AppError} from '../shared/errors.mjs';import {identifier,mutationId} from '../server/validation.mjs';import {digest} from './store.mjs';
export async function handoffRoute({path,req,body,store}){
 const match=path.match(/^\/api\/handoff\/([-\w]+)(?:\/(preview|apply))?$/);if(!match)return null;
 if(req.method==='POST'&&match[2]==='apply'){const prior=await store.mutation(mutationId(body.mutationId),await digest(JSON.stringify({path,body})));if(prior)return Response.json(prior);}
 const plan=await loadPlan(store,['task','course','material','coursework']),task=plan.get('task',identifier(match[1]));if(!task)throw new AppError('Task not found',404);
 const context={task,course:task.data.courseId?plan.get('course',task.data.courseId):null,materials:plan.list('material'),drafts:plan.list('coursework')};
 if(req.method==='GET'&&!match[2]){const prepared=prepareHandoff(context);for(const source of prepared.packet.sourceText){if(await store.sql('SELECT object_key FROM private_objects WHERE object_key=? AND verified=1','material:'+source.id).first())prepared.files.push({name:source.id+'.pdf',mimeType:'application/pdf',downloadUrl:'/api/materials/'+source.id+'/file'});}return Response.json(prepared);}
 if(req.method==='POST'&&['preview','apply'].includes(match[2])){
  const validated=validateHandoffReturn(body.proposal,context);if(match[2]==='preview')return Response.json(validated);
  if(body.approved!==true)throw new AppError('Preview and approve the task edits first',403);
  const item=plan.put('task',task.id,{...task.data,...validated.changes,handoffReviewedAt:new Date().toISOString()},task.version,{actor:'owner-approved-handoff'});
  return Response.json(await commitPlan(store,plan,{id:mutationId(body.mutationId),fingerprint:{path,body},result:{item}}));
 }
 throw new AppError('Method not allowed',405);
}
