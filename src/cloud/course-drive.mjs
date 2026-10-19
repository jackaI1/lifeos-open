import {AppError} from '../shared/errors.mjs';
import {googleFetch,privateFile} from './google.mjs';
import {validateSource} from '../../public/lecture-sources.js';
import {digest} from './store.mjs';
import {localDate,weekday,zonedParts} from '../domain/time.mjs';

const fields='id,name,mimeType,size,modifiedTime,md5Checksum,shared,trashed,parents,owners(emailAddress)';
const folderType='application/vnd.google-apps.folder';
export function courseDriveSlot(now=new Date().toISOString()){
 const date=localDate(now,'America/Toronto'),day=weekday(date),clock=zonedParts(now,'America/Toronto').time;
 const minute=Number(clock.slice(0,2))*60+Number(clock.slice(3,5));
 if(day===0||day===6||minute<450||minute>=1170)return null;
 return date+':'+String(Math.floor((minute-450)/60)+7).padStart(2,'0')+':30';
}
export async function courseFolders(store,env,courseId){
 const library=await store.get('course-library',courseId);
 if(!library||library.data.courseId!==courseId)throw new AppError('This course has no connected Drive folder yet.',404);
 const d=library.data,root=await privateFile(env,d.folderId,d.termFolderId);
 if(root.mimeType!==folderType)throw new AppError('Course folder changed.',409);
 const folders=[{id:root.id,label:'Course files'}];
 for(const [label,id] of Object.entries(d.sections??{}).slice(0,8)){
  const folder=await privateFile(env,id,d.folderId);
  if(folder.mimeType!==folderType)throw new AppError('Course section changed.',409);
  folders.push({id,label});
 }
 return {library,folders};
}
export async function courseDrivePage({store,env,courseId,pageToken=null,pageSize=50}){
 if(pageToken&&(typeof pageToken!=='string'||pageToken.length>2048))throw new AppError('Invalid course page.');
 const {library,folders}=await courseFolders(store,env,courseId);
 const q='trashed=false and mimeType=\'application/pdf\' and ('+folders.map(f=>`'${f.id}' in parents`).join(' or ')+')';
 const query=new URLSearchParams({q,pageSize:String(Math.min(50,pageSize)),orderBy:'modifiedTime desc,name',fields:`nextPageToken,incompleteSearch,files(${fields})`,...(pageToken?{pageToken}:{})});
 const page=await(await googleFetch(env,'https://www.googleapis.com/drive/v3/files?'+query)).json(),items=[];
 for(const file of page.files??[]){
  const folder=folders.find(f=>file.parents?.includes(f.id));if(!folder)continue;
  try{const data=validateSource(file,'slides',env.ALLOWED_EMAIL);items.push({id:file.id,data:{...data,courseId,section:folder.label}});}catch{/* Shared, oversized or unfinished files are not import candidates. */}
 }
 return {items,nextPageToken:page.nextPageToken??null,partial:!!page.incompleteSearch,folderUrl:'https://drive.google.com/drive/folders/'+library.data.folderId,lastLearnCheck:library.data.lastLearnCheck??null};
}
export async function courseDriveSource({store,env,courseId,fileId,md5}){
 const {folders}=await courseFolders(store,env,courseId);
 if(!/^[\w-]{10,200}$/.test(fileId??''))throw new AppError('Invalid course file.');
 const file=await(await googleFetch(env,'https://www.googleapis.com/drive/v3/files/'+fileId+'?fields='+encodeURIComponent(fields))).json();
 if(!folders.some(f=>file.parents?.includes(f.id)))throw new AppError('Choose a PDF from this course folder.',403);
 let data;try{data=validateSource(file,'slides',env.ALLOWED_EMAIL);}catch(e){throw new AppError(e.message,403);}
 if(data.mimeType!=='application/pdf')throw new AppError('Choose a PDF slide deck.');
 if(data.md5!==md5)throw new AppError('This deck changed. Refresh the list before adding it.',409);
 return {...data,courseId};
}

// Drive checks are separate from LEARN collection. They never advance lastLearnCheck.
export async function queueCourseDriveSync(store,config,now=new Date().toISOString()){
 const slot=courseDriveSlot(now);if(!config.integrationsEnabled||!slot||await store.meta('automationPaused'))return;
 if(await store.meta('course-drive-slot')===slot)return;
 if(await store.sql("SELECT id FROM jobs WHERE component='cloud' AND type='course-drive-sync' AND status IN ('queued','running') LIMIT 1").first())return;
 const id='course-drive-'+(await digest(slot)).slice(0,32);
 await store.commit({id:'schedule-'+id,fingerprint:{slot},jobs:[{id,type:'course-drive-sync',component:'cloud',priority:4,payload:{slot},dedupeKey:id,authority:'owner-hourly-course-drive'}],extra:[store.sql("INSERT INTO meta VALUES('course-drive-slot',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(slot))],result:{queued:true}});
}
export async function syncCourseDriveSlice({store,env,job}){
 const key='course-drive-cursor',old=await store.meta(key),cursor=old?.jobId===job.id?old:{jobId:job.id,after:'',courseId:null,pageToken:null};
 let courseId=cursor.courseId;
 if(!courseId){courseId=(await store.sql("SELECT id FROM records WHERE kind='course-library' AND id>? ORDER BY id LIMIT 1",cursor.after).first())?.id;if(!courseId)return {complete:true};}
 const page=await courseDrivePage({store,env,courseId,pageToken:cursor.pageToken,pageSize:10});
 if(page.partial)throw new AppError('Google returned an incomplete course listing.',503);
 const changes=[],now=new Date().toISOString();
 for(const item of page.items){
  const id=courseId+'-drive-'+(await digest(item.data.fileId+':'+item.data.md5+':'+item.data.modifiedTime)).slice(0,24);
  if(await store.get('lecture-course-source',id))continue;
  const data={...item.data,discoveredAt:now,source:'course-drive',fromDay:null,throughDay:null};
  changes.push({kind:'lecture-course-source',id,before:null,after:{kind:'lecture-course-source',id,data,version:1,createdAt:now,updatedAt:now},auditId:crypto.randomUUID(),actor:'course-drive-sync'});
 }
 const next={jobId:job.id,after:page.nextPageToken?cursor.after:courseId,courseId:page.nextPageToken?courseId:null,pageToken:page.nextPageToken};
 if(!page.nextPageToken){const before=await store.get('course-library',courseId);changes.push({kind:'course-library',id:courseId,before,after:{...before,version:before.version+1,updatedAt:now,data:{...before.data,lastDriveCheck:now,driveRefresh:'hourly-weekdays-0730-1830',learnRefresh:before.data.learnRefresh??'existing-quota-gated-collector'}},auditId:crypto.randomUUID(),actor:'course-drive-sync'});}
 await store.commit({id:'course-drive-page-'+(await digest(job.id+':'+courseId+':'+(cursor.pageToken??''))).slice(0,40),fingerprint:{jobId:job.id,courseId,pageToken:cursor.pageToken},changes,extra:[store.sql('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(next))],result:{indexed:changes.filter(c=>c.kind==='lecture-course-source').length}});
 return {complete:false};
}
