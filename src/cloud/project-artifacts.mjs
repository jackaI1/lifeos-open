import * as v from '../server/validation.mjs';
import {AppError} from '../shared/errors.mjs';
import {validateProjectArtifact} from '../shared/project-artifact.mjs';
import {digest} from './store.mjs';

function sourceBinding(thread,input){
 const source=thread?.data.preparationSnapshot,context=input?.data.job?.context?.assistant;
 if(!thread?.data.preparationOnly||thread.data.scope!=='today'||input?.data.job?.id!==input.id||context?.scope!=='today'||context?.preparationPurpose!=='starting-point'||source?.id!==thread.data.projectId||source.version!==thread.data.projectVersion||input?.data.job?.payload?.threadId!==thread.id||context?.preparationOnly!==true||context.projects?.length!==1||context.projects[0].id!==source.id||context.projects[0].version!==source.version)throw new AppError('Preparation source identity is unavailable',409);
 const captured=context.projects[0],keys=Object.keys(source).sort();if(JSON.stringify(Object.keys(captured).sort())!==JSON.stringify(keys)||keys.some(key=>JSON.stringify(source[key])!==JSON.stringify(captured[key])))throw new AppError('Preparation source snapshot has changed',409);
 const capturedAt=source.capturedAt??thread.createdAt;if(!Number.isFinite(Date.parse(capturedAt)))throw new AppError('Preparation capture time is unavailable',409);
 return {projectId:source.id,projectVersion:source.version,purpose:'starting-point',capturedAt,notesTruncated:!!source.notesTruncated,inputVersion:input.version};
}

export function savedProjectPreparation(thread,input,out){
 const source=sourceBinding(thread,input);
 // Retain valid earlier worker replies; they are conversations, never fabricated artifacts.
 if(out.artifact===undefined)return null;
 if(out.needsInput){if(out.artifact!==null)throw new AppError('A clarification cannot contain ready prepared work');return null;}
 if(out.artifact===null)throw new AppError('Prepared work is missing; ask for input if a necessary fact is unknown');
 return {artifact:validateProjectArtifact(out.artifact),source,disposition:'ready'};
}

async function boundReply(store,id){
 const item=await store.get('support-message',v.identifier(id));if(!item?.data.preparation||item.data.role!=='assistant'||item.id!==item.data.jobId+'-reply')throw new AppError('Prepared work not found',404);
 const thread=await store.get('support-thread',item.data.threadId),input=await store.get('job-input',item.data.jobId),source=sourceBinding(thread,input);
 if(input.id!==item.data.jobId||JSON.stringify(source)!==JSON.stringify(item.data.preparation.source))throw new AppError('Prepared work source has changed',409);
 validateProjectArtifact(item.data.preparation.artifact);v.enumValue(item.data.preparation.disposition,['ready','kept','dismissed']);return {item,thread,input};
}

export async function projectArtifactsRoute({store,req,path,body,config}){
 if(!path.startsWith('/api/assistant/preparations'))return null;
 if(config.environment!=='beta')throw new AppError('Project preparations are available on beta',403);
 if(path==='/api/assistant/preparations'&&req.method==='GET'){
  const query=new URL(req.url).searchParams,projectId=v.identifier(query.get('projectId')),history=query.get('history')==='1',offset=Number(query.get('offset')??0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new AppError('Invalid preparation page');
  const rows=(await store.sql("SELECT m.id FROM records m JOIN records t ON t.kind='support-thread' AND t.id=json_extract(m.data,'$.threadId') WHERE m.kind='support-message' AND json_extract(t.data,'$.preparationOnly')=1 AND json_extract(t.data,'$.projectId')=? AND json_extract(m.data,'$.preparation.source.projectId')=?"+(history?'':" AND json_extract(m.data,'$.preparation.disposition')!='dismissed'")+" ORDER BY m.created_at DESC,m.id DESC LIMIT 21 OFFSET ?",projectId,projectId,offset).all()).results;
  const items=[];for(const row of rows.slice(0,20))items.push((await boundReply(store,row.id)).item);
  return Response.json({items,nextOffset:rows.length>20?offset+20:null});
 }
 const match=path.match(/^\/api\/assistant\/preparations\/([-\w]+)\/disposition$/);
 if(!match||req.method!=='POST')throw new AppError('Preparation endpoint not found',404);
 v.exactFields(body,['version','decision','mutationId']);v.version(body.version);v.enumValue(body.decision,['keep','dismiss']);const fingerprint={path,body},prior=await store.mutation(v.mutationId(body.mutationId),await digest(JSON.stringify(fingerprint)));if(prior)return Response.json(prior);
 const {item,thread,input}=await boundReply(store,match[1]);if(item.version!==body.version)throw new AppError('Prepared work changed. Your decision has not overwritten it.',409);
 const now=new Date().toISOString(),after={...item,version:item.version+1,updatedAt:now,data:{...item.data,preparation:{...item.data.preparation,disposition:body.decision==='keep'?'kept':'dismissed',decidedAt:now}}};
 return Response.json(await store.commit({id:body.mutationId,fingerprint,reads:[{kind:thread.kind,id:thread.id,version:thread.version},{kind:input.kind,id:input.id,version:input.version}],changes:[{kind:item.kind,id:item.id,before:item,after,auditId:crypto.randomUUID(),actor:'owner-preparation-disposition'}],result:{item:after}}));
}
