// Intentionally absent from generic records, bootstrap, search and every worker input allowlist.
import {AppError} from '../shared/errors.mjs';
import * as v from '../server/validation.mjs';
import {digest} from './store.mjs';
import {privateObject} from './objects.mjs';
import {googleFetch,privateFile} from './google.mjs';
import {boundedBytes} from './files.mjs';
export const PRIVATE_KINDS={entries:'private-journal',templates:'private-journal-template',photos:'private-daily-photo'};
function questions(values,answers=false){
 if(!Array.isArray(values)||!values.length||values.length>20)throw new AppError('Use between one and twenty prompts');
 const ids=new Set();return values.map(q=>{v.exactFields(q,answers?['id','prompt','text']:['id','prompt']);v.identifier(q.id);if(ids.has(q.id))throw new AppError('Prompt IDs must be distinct');ids.add(q.id);return {id:q.id,prompt:v.text(q.prompt,300,{required:true}),...(answers?{text:v.text(q.text,40000)}:{})};});
}
export function momentData(type,data){
 if(type==='templates'){v.exactFields(data,['name','questions']);return {name:v.text(data.name,100,{required:true}),questions:questions(data.questions)};}
 if(type==='entries'){v.exactFields(data,['day','title','templateId','templateName','answers']);const result={day:v.date(data.day),title:v.text(data.title,160),templateId:data.templateId?v.identifier(data.templateId):null,templateName:v.text(data.templateName??'',100),answers:questions(data.answers,true)};if(JSON.stringify(result).length>180000)throw new AppError('This entry is too long. Save another moment.',413);return result;}
 v.exactFields(data,['day','caption']);return {day:v.date(data.day),caption:v.text(data.caption??'',4000)};
}
export function validateDailyImage(p){
 v.exactFields(p,['image','thumbnail','width','height']);for(const [key,max] of [['image',720000],['thumbnail',70000]])if(typeof p[key]!=='string'||p[key].length>max||!/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(p[key])||p[key].split(',')[1].length%4)throw new AppError('Choose a bounded JPEG photo');
 for(const key of ['width','height']){v.number(p[key],1,2600);if(!Number.isInteger(p[key]))throw new AppError('Invalid photo dimensions');}return p;
}
export async function readMomentObject({store,env,config,key}){
 const object=await store.sql('SELECT * FROM private_objects WHERE object_key=? AND verified=1',key).first();
 if(!object||object.folder_id!==config.driveFolders.uploads||object.mime_type!=='application/json'||object.size>800000)throw new AppError('Private photo unavailable',404);
 await privateFile(env,object.drive_id,object.folder_id);
 const bytes=await boundedBytes(await googleFetch(env,`https://www.googleapis.com/drive/v3/files/${object.drive_id}?alt=media`),800000);
 if(await digest(bytes)!==object.sha256)throw new AppError('Photo integrity check failed',503);return bytes;
}
export async function privateMomentsRoute({store,env,config,req,path,body,writeObject=privateObject,readObject=readMomentObject}){
 const match=path.match(/^\/api\/(?:private-journal\/(entries|templates)|daily-photos)(?:\/([-\w]+))?(\/image)?$/);if(!match)return null;
 const type=match[1]??'photos',kind=PRIVATE_KINDS[type],id=match[2],image=match[3];if(id)v.identifier(id);
 if(req.method==='GET'){
  if(image){if(type!=='photos'||!id)throw new AppError('Not found',404);const item=await store.get(kind,id);if(!item)throw new AppError('Photo not found',404);const thumbnail=new URL(req.url).searchParams.get('size')==='thumbnail',photo=JSON.parse(new TextDecoder().decode(await readObject({store,env,config,key:thumbnail?item.data.thumbnailKey:item.data.objectKey})));const encoded=thumbnail?photo.thumbnail:validateDailyImage(photo).image;if(typeof encoded!=='string'||!/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new AppError('Photo integrity check failed',503);return new Response(Uint8Array.from(atob(encoded.split(',')[1]),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
  if(id){const item=await store.get(kind,id);if(!item)throw new AppError('Entry not found',404);return Response.json({item});}
  const offset=Number(new URL(req.url).searchParams.get('offset')??0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new AppError('Invalid history page');
  // Metadata only for entry history. The kind/updated index bounds each read to one page.
  const projection=type==='entries'?"json_object('day',json_extract(data,'$.day'),'title',json_extract(data,'$.title'),'templateName',json_extract(data,'$.templateName'))":'data';
  const rows=(await store.sql(`SELECT id,version,created_at,updated_at,${projection} data FROM records WHERE kind=? ORDER BY updated_at DESC,id LIMIT 26 OFFSET ?`,kind,offset).all()).results;
  return Response.json({items:rows.slice(0,25).map(r=>({id:r.id,kind,version:r.version,createdAt:r.created_at,updatedAt:r.updated_at,data:JSON.parse(r.data)})),nextOffset:rows.length>25?offset+25:null});
 }
 if(req.method!=='PUT'||!id||image)throw new AppError('Method not allowed',405);
 v.exactFields(body,type==='photos'?['version','mutationId','data','photo']:['version','mutationId','data']);v.version(body.version);v.mutationId(body.mutationId);
 const fingerprint={path,body},prior=await store.mutation(body.mutationId,await digest(JSON.stringify(fingerprint)));if(prior)return Response.json(prior);
 const before=await store.get(kind,id);if((before?.version??0)!==body.version)throw new AppError('This entry changed on another device. Your draft is still on this device.',409,'conflict');
 let data=momentData(type,body.data);
 if(type==='photos'){
  if(!before&&!body.photo)throw new AppError('Choose a photo first');
  if(body.photo){const content=JSON.stringify(validateDailyImage(body.photo)),hash=await digest(content),objectKey='daily-photo:'+id+':'+hash;
   await writeObject({store,env,folder:config.driveFolders.uploads,key:objectKey,name:'daily-photo-'+id+'.json',mime:'application/json',content});
   const thumbnailKey=objectKey+':thumb';await writeObject({store,env,folder:config.driveFolders.uploads,key:thumbnailKey,name:'daily-photo-'+id+'-thumb.json',mime:'application/json',content:JSON.stringify({thumbnail:body.photo.thumbnail})});
   data={...data,objectKey,thumbnailKey,sha256:hash,width:body.photo.width,height:body.photo.height};
  }else data={...before.data,...data};
 }
 const now=new Date().toISOString(),item={kind,id,data,version:body.version+1,createdAt:before?.createdAt??now,updatedAt:now};
 return Response.json(await store.commit({id:body.mutationId,fingerprint,changes:[{kind,id,before,after:item,auditId:crypto.randomUUID(),actor:'owner-private-moment'}],result:{item}}));
}
