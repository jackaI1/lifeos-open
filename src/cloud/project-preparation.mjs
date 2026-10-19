import {AppError} from '../shared/errors.mjs';
import * as v from '../server/validation.mjs';

export async function projectPreparationBinding(store,body,config){
 if(body.projectId===undefined){if(body.projectVersion!==undefined)throw new AppError('Choose a project before its version');return null;}
 if(config.environment!=='beta')throw new AppError('Project preparation is available on beta',403);
 if(body.scope!=='today')throw new AppError('Project preparation belongs to project help');
 const id=v.identifier(body.projectId),version=v.version(body.projectVersion),project=await store.get('project',id);
 if(!project||project.version!==version)throw new AppError('The project changed. Reopen it before preparing help.',409);
 v.text(project.data.title,300,{required:true});v.text(project.data.nextStep??'',2000);v.text(project.data.category??'',80);v.text(project.data.status??'',30);
 const notes=String(project.data.notes??'');
 return {projectId:id,projectVersion:version,preparationOnly:true,preparationSnapshot:{id,version,capturedAt:new Date().toISOString(),title:project.data.title,category:project.data.category,status:project.data.status,nextStep:project.data.nextStep??'',notes:notes.slice(0,6000),notesTruncated:notes.length>6000}};
}

export function projectPreparationContext(thread,now){
 if(!thread.data.preparationOnly||!thread.data.projectId||thread.data.preparationSnapshot?.id!==thread.data.projectId||thread.data.preparationSnapshot.version!==thread.data.projectVersion)throw new AppError('Project preparation identity is unavailable',409);
 return {scope:'today',asOf:now,preparationOnly:true,preparationPurpose:'starting-point',projects:[thread.data.preparationSnapshot],tasks:[],courses:[],schedule:[],practices:[],preferences:{}};
}
