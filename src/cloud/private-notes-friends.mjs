import {AppError} from '../shared/errors.mjs';
import * as v from '../server/validation.mjs';
import {digest} from './store.mjs';
import {privateObject} from './objects.mjs';
import {readMomentObject,validateDailyImage} from './private-moments.mjs';
import {validateDocument,documentText,plainDocument} from '../../public/document-format.js';
import {validContactSchedule,nextContactDay,dueContact,matchedPrayerPerson} from '../../public/friend-schedule.js';
import {lifeosDay} from '../../public/lifeos-day.js';

export const NOTE_FRIEND_KINDS=['private-note','private-note-folder','private-friend','private-contact-completion','private-note-image'];
const itemChange=(kind,id,before,data,actor='owner-private-workspace')=>({kind,id,before,after:{kind,id,data,version:(before?.version??0)+1,createdAt:before?.createdAt??new Date().toISOString(),updatedAt:new Date().toISOString()},actor,auditId:crypto.randomUUID()});
const json=r=>Response.json(r);
async function history(store,kind,{offset=0,search='',folder=''}={}){
 if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new AppError('Invalid page');
 const args=[kind];let where='kind=?';
 if(folder){where+=" AND json_extract(data,'$.folderId')=?";args.push(folder);}
 if(search){where+=" AND (instr(lower(json_extract(data,'$.title')),lower(?))>0 OR instr(lower(json_extract(data,'$.text')),lower(?))>0 OR instr(lower(json_extract(data,'$.name')),lower(?))>0)";args.push(search,search,search);}
 const projection=kind==='private-note'?"json_object('title',json_extract(data,'$.title'),'text',substr(json_extract(data,'$.text'),1,140),'folderId',json_extract(data,'$.folderId'),'pinned',json_extract(data,'$.pinned'))":kind==='private-friend'?"json_object('name',json_extract(data,'$.name'),'schedule',json_extract(data,'$.schedule'),'dueDay',json_extract(data,'$.dueDay'),'archived',json_extract(data,'$.archived'))":'data';
 const rows=(await store.sql(`SELECT id,version,created_at,updated_at,${projection} data FROM records WHERE ${where} ORDER BY COALESCE(json_extract(data,'$.pinned'),0) DESC,updated_at DESC,id LIMIT 41 OFFSET ?`,...args,offset).all()).results;
 return {items:rows.slice(0,40).map(r=>({id:r.id,kind,version:r.version,data:JSON.parse(r.data),createdAt:r.created_at,updatedAt:r.updated_at})),nextOffset:rows.length>40?offset+40:null};
}
async function prayerSources(store){const rows=(await store.sql("SELECT kind,id,data FROM records WHERE kind IN ('prayer-list','prayer-note') ORDER BY updated_at DESC LIMIT 1000").all()).results.map(r=>({...r,data:JSON.parse(r.data)})),lists=rows.filter(r=>r.kind==='prayer-list'&&Array.isArray(r.data.sections)&&!r.data.archived);return lists.length?lists.flatMap(r=>r.data.sections.map(s=>({id:r.id+':'+s.id,data:{nodes:s.nodes??[]}}))):rows.filter(r=>r.kind==='prayer-note');}
export async function privateNotesFriendsRoute({store,env,config,req,path,body,writeObject=privateObject,readObject=readMomentObject,now=new Date().toISOString()}){
 const m=path.match(/^\/api\/private-(notes|friends)(?:\/(folders|images|due))?(?:\/([-\w]+))?(?:\/(image|complete|prayer|share))?$/);if(!m)return null;
 const [,app,sub,id,action]=m,isFriend=app==='friends',kind=sub==='folders'?'private-note-folder':sub==='images'?'private-note-image':isFriend?'private-friend':'private-note';if(id)v.identifier(id);
 const url=new URL(req.url),day=lifeosDay(now);if(!isFriend&&sub==='due'||isFriend&&sub==='folders'||sub==='images'&&!id)throw new AppError('Not found',404);
 if(req.method==='GET'){
  if(sub==='due'){if(!isFriend)throw new AppError('Not found',404);const rows=(await store.sql("SELECT id,version,json_object('name',json_extract(data,'$.name'),'dueDay',json_extract(data,'$.dueDay'),'schedule',json_extract(data,'$.schedule')) data FROM records WHERE kind='private-friend' AND json_extract(data,'$.dueDay')<=? AND COALESCE(json_extract(data,'$.archived'),0)=0 ORDER BY json_extract(data,'$.dueDay'),id LIMIT 101",day).all()).results;return json({items:rows.slice(0,100).map(r=>({...r,data:JSON.parse(r.data)})),more:rows.length>100,day});}
  if(!id)return json(await history(store,kind,{offset:Number(url.searchParams.get('offset')??0),search:v.text(url.searchParams.get('q')??'',120),folder:url.searchParams.get('folder')??''}));
  const item=await store.get(kind,id);if(!item||sub==='images'&&item.data.ownerType!==app)throw new AppError('Entry not found',404);
  if(action==='image'){if(kind!=='private-note-image'||item.data.ownerType!==app)throw new AppError('Image not found',404);const content=JSON.parse(new TextDecoder().decode(await readObject({store,env,config,key:item.data.objectKey})));validateDailyImage(content);return new Response(Uint8Array.from(atob(content.image.split(',')[1]),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
  if(action==='prayer'){if(!isFriend)throw new AppError('Not found',404);const matched=matchedPrayerPerson(item.data.name,await prayerSources(store));return json({links:matched.links.length?matched.links:item.data.prayerSnapshot?.name===item.data.name?item.data.prayerSnapshot.links:[],ambiguous:matched.ambiguous});}
  if(action==='share'){if(isFriend||kind!=='private-note')throw new AppError('This private content cannot be shared with AI',403);return json({text:[item.data.title,item.data.text].filter(Boolean).join('\n\n'),explicitOwnerSelection:true});}
  return json({item});
 }
 if(!id||!['PUT','POST'].includes(req.method))throw new AppError('Method not allowed',405);
 v.mutationId(body.mutationId);v.version(body.version);const fingerprint={path,body};const prior=await store.mutation(body.mutationId,await digest(JSON.stringify(fingerprint)));if(prior)return json(prior);
 const before=await store.get(kind,id);if((before?.version??0)!==body.version)throw new AppError('This entry changed on another device. Your draft is preserved.',409,'conflict');
 if(action==='complete'){
  if(!isFriend||!before)throw new AppError('Friend not found',404);v.exactFields(body,['version','mutationId']);if(!dueContact(before.data,day))throw new AppError('There is no due check-in',409);
  const dueDay=nextContactDay(before.data.schedule??{frequency:'none'},day),change=itemChange(kind,id,before,{...before.data,dueDay,lastContactDay:day});const completionId=id+'-'+before.data.dueDay;
  const old=await store.get('private-contact-completion',completionId);return json(await store.commit({id:body.mutationId,fingerprint,changes:[change,...(!old?[itemChange('private-contact-completion',completionId,null,{friendId:id,scheduledDay:before.data.dueDay,completedAt:now})]:[])],result:{item:change.after}}));
 }
 if(req.method!=='PUT'||action)throw new AppError('Method not allowed',405);
 let data;v.exactFields(body,sub==='images'?['version','mutationId','data','photo']:['version','mutationId','data']);
 if(sub==='images'){
  if(before)throw new AppError('Images are immutable',409);v.exactFields(body.data,['ownerId']);v.identifier(body.data.ownerId);const parent=await store.get(isFriend?'private-friend':'private-note',body.data.ownerId);if(!parent)throw new AppError('Save the note before attaching a photo',404);
  const photo=validateDailyImage(body.photo),content=JSON.stringify(photo),key='private-workspace-image:'+id+':'+await digest(content);await writeObject({store,env,folder:config.driveFolders.uploads,key,name:'private-image-'+id+'.json',mime:'application/json',content});data={ownerType:app,ownerId:parent.id,objectKey:key,width:photo.width,height:photo.height};
 }else if(sub==='folders'){if(isFriend)throw new AppError('Not found',404);v.exactFields(body.data,['title']);data={title:v.text(body.data.title,80,{required:true})};}
 else if(isFriend){v.exactFields(body.data,['name','text','schedule','dueDay','archived','memories','lastContactDay','prayerSnapshot']);const name=v.text(body.data.name,100,{required:true}),schedule=validContactSchedule(body.data.schedule??{frequency:'none'});data={...before?.data,name,text:v.text(body.data.text??'',100000),schedule,dueDay:body.data.dueDay?v.date(body.data.dueDay):null,archived:body.data.archived===true,memories:before?.data.memories??[]};if(body.data.memories){if(!Array.isArray(body.data.memories)||body.data.memories.length>500||body.data.memories.some(p=>!data.memories.some(m=>m.id===p.id)))throw new AppError('Invalid memory edit');data.memories=data.memories.map(old=>{const changed=body.data.memories.find(p=>p.id===old.id);return changed?{...old,text:v.text(changed.text,700,{required:true}),hidden:changed.hidden===true}:old;});}}
 else{v.exactFields(body.data,['title','document','text','folderId','pinned','imageIds']);const document=validateDocument(body.data.document??plainDocument(body.data.text??'')),folderId=body.data.folderId?v.identifier(body.data.folderId):null;if(folderId&&!await store.get('private-note-folder',folderId))throw new AppError('Folder no longer exists',409);const imageIds=body.data.imageIds??[];if(!Array.isArray(imageIds)||imageIds.length>30)throw new AppError('Use at most 30 photos');for(const imageId of imageIds){const image=await store.get('private-note-image',v.identifier(imageId));if(image?.data.ownerType!=='notes'||image.data.ownerId!==id)throw new AppError('Photo belongs to another note',403);}data={title:v.text(body.data.title??'',200),document,text:documentText(document),folderId,pinned:body.data.pinned===true,imageIds};}
 if(JSON.stringify(data).length>200000)throw new AppError('This note is too large. Start another note.',413);
 if(isFriend&&!sub&&(!before||before.data.name!==data.name)){const matched=matchedPrayerPerson(data.name,await prayerSources(store));if(matched.links.length)data.prayerSnapshot={name:data.name,links:matched.links,capturedAt:now};}
 if(JSON.stringify(data).length>200000)throw new AppError('This note and linked requests are too large for one entry.',413);
 const change=itemChange(kind,id,before,data);return json(await store.commit({id:body.mutationId,fingerprint,changes:[change],result:{item:change.after}}));
}
