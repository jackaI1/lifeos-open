import {mergeStudyMarks} from '../../public/lecture-study.js';
import {NOTEBOOK_MAX_PAGES} from '../../public/lecture-layout.js';
import {AppError} from '../shared/errors.mjs';
import * as v from '../server/validation.mjs';
import {digest} from './store.mjs';
import {privateObject} from './objects.mjs';
import {privateFile,googleFetch} from './google.mjs';
import {boundedBytes} from './files.mjs';
import {validateInkPatch} from '../../public/lecture-ink-patch.js';
import {LECTURE} from '../../public/lecture-core.js';
import {sourceAppliesToLecture} from '../../public/lecture-sources.js';
const unpack=r=>({kind:r.kind,id:r.id,data:JSON.parse(r.data),version:r.version,createdAt:r.created_at,updatedAt:r.updated_at});
export async function readInkObject({store,env,config,key}){
 const object=await store.sql('SELECT * FROM private_objects WHERE object_key=? AND verified=1',key).first();
 if(!object||object.folder_id!==config.driveFolders.uploads)throw new AppError('Private notes unavailable',404);
 await privateFile(env,object.drive_id,object.folder_id);
 const bytes=await boundedBytes(await googleFetch(env,`https://www.googleapis.com/drive/v3/files/${object.drive_id}?alt=media`),LECTURE.maxPageBytes);
 if(await digest(bytes)!==object.sha256)throw new AppError('Note integrity check failed',503);
 return bytes;
}
// Internal ink rows deliberately stay out of bootstrap and generic record APIs.
export async function lectureInkRoute({store,env,config,req,lecture,pageId,part,sequence,json,change,writeObject=privateObject,readObject=readInkObject}){
 if(!/^\d{4}$/.test(pageId)||Number(pageId)<1||Number(pageId)>NOTEBOOK_MAX_PAGES)throw new AppError('Invalid note page');
 const key=lecture.id+'-p-'+pageId,prefix=key+'-i-',before=await store.get('lecture-page',key),url=new URL(req.url);
 if(req.method==='GET'){
  if(part==='base'){if(sequence)throw new AppError('Invalid base path',404);
   const objectKey=before?.data.inkFormat==='patches-v1'?before.data.baseObjectKey:before?.data.objectKey;
   if(!objectKey)throw new AppError('This page has no older base',404);
   return new Response(await readObject({store,env,config,key:objectKey}),{headers:{'Content-Type':'application/json'}});
  }
  if(part==='chunks'){
   if(!/^\d{1,6}$/.test(sequence??'')||Number(sequence)<1)throw new AppError('Invalid ink sequence');
   const row=await store.get('lecture-ink',prefix+String(Number(sequence)).padStart(6,'0'));
   if(!row||row.data.lectureId!==lecture.id||row.data.pageId!==pageId||row.data.sequence>(before?.data.inkHead??0))throw new AppError('Ink chunk not found',404);
   return new Response(await readObject({store,env,config,key:row.data.objectKey}),{headers:{'Content-Type':'application/json'}});
  }
  const after=Number(url.searchParams.get('after')??0),head=Number(url.searchParams.get('through')??before?.data.inkHead??0);
  if(!Number.isInteger(after)||after<0||!Number.isInteger(head)||head<0||head>(before?.data.inkHead??0)||after>head)throw new AppError('Invalid ink page cursor');
  const found=(await store.sql("SELECT * FROM records WHERE kind='lecture-ink' AND id>? AND id<=? ORDER BY id LIMIT 501",prefix+String(after).padStart(6,'0'),prefix+String(head).padStart(6,'0')).all()).results.map(unpack),chunks=found.slice(0,500);
  return Response.json({item:before,base:Boolean(before?.data.inkFormat==='patches-v1'?before.data.baseObjectKey:before?.data.objectKey),head,chunks,nextCursor:found.length>500?chunks.at(-1).data.sequence:null});
 }
 if(req.method!=='POST'||part)throw new AppError('Method not allowed',405);
 const b=await json(req);v.exactFields(b,['mutationId','version','patch']);const mutationId=v.mutationId(b.mutationId),fingerprint={path:url.pathname,b};
 const cached=await store.mutation(mutationId,await digest(JSON.stringify(fingerprint)));if(cached)return Response.json(cached);
 if(v.version(b.version)!==(before?.version??0))throw new AppError('Notes changed on another device. Your local ink is retained.',409,'ink-conflict');
 try{validateInkPatch(b.patch,pageId);}catch(error){throw new AppError(error.message,400);}
 for(const background of [b.patch.meta.background,...b.patch.attachments.map(a=>a.background)].filter(Boolean)){
  const source=await store.get('lecture-source',background.sourceId)??await store.get('lecture-course-source',background.sourceId)??await store.get('lecture-photo',background.sourceId);
  if(!source||(source.kind==='lecture-photo'?source.data.lectureId!==lecture.id||source.data.sha256!==background.sourceHash:!sourceAppliesToLecture(source,lecture)||!['notes','slides'].includes(source.data.role)))throw new AppError('Attach this source to the same lecture first',409);
 }
 let minimumHeight=before?(before.data.height??LECTURE.pageHeight):400;
 if(before?.data.objectKey&&before.data.inkFormat!=='patches-v1'){const base=JSON.parse(new TextDecoder().decode(await readObject({store,env,config,key:before.data.objectKey})));minimumHeight=Math.max(minimumHeight,base.height??LECTURE.pageHeight);}
 if((b.patch.meta.height??LECTURE.pageHeight)<minimumHeight)throw new AppError('The saved paper bounds must be preserved',409,'ink-bounds');
 const next=(before?.data.inkHead??0)+1;if(next>10000)throw new AppError('This notebook needs an archive before more cloud changes',413);
 const content=JSON.stringify(b.patch),sha=await digest(content),objectKey='lecture-ink:'+key+':'+sha;
 await writeObject({store,env,folder:config.driveFolders.uploads,key:objectKey,name:key+'-ink-'+next+'.json',mime:'application/json',content});
 const inkId=prefix+String(next).padStart(6,'0'),ink=change('lecture-ink',inkId,null,{lectureId:lecture.id,pageId,sequence:next,objectKey,sha256:sha}),meta=b.patch.meta;
 const page=change('lecture-page',key,before,{...before?.data,lectureId:lecture.id,pageId,inkFormat:'patches-v1',inkHead:next,studyMarks:mergeStudyMarks(before?.data.studyMarks,b.patch.strokes),baseObjectKey:before?.data.inkFormat==='patches-v1'?before.data.baseObjectKey??null:before?.data.objectKey??null,height:Math.max(before?.data.height??400,meta.height??LECTURE.pageHeight),lastOffsetMs:Math.max(before?.data.lastOffsetMs??0,...b.patch.strokes.map(s=>s.endedAtOffsetMs)),inkAvailable:true,...(Object.hasOwn(meta,'background')?{sourceBackground:meta.background?{sourceId:meta.background.sourceId,sourceHash:meta.background.sourceHash,sourcePage:meta.background.sourcePage,crop:meta.background.crop}:null}:{})});
 return Response.json(await store.commit({id:mutationId,fingerprint,changes:[ink,page],result:{item:page.after,chunk:ink.after,saved:true}}));
}
