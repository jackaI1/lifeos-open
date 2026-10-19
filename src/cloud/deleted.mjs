import {AppError} from '../shared/errors.mjs';

import * as v from '../server/validation.mjs';

import {digest} from './store.mjs';

import {googleFetch,privateFile} from './google.mjs';

export const deletionKinds=Object.freeze(['private-note','private-friend','private-note-folder','devotional','prayer-session','prayer-note','lecture','private-journal','private-journal-template','private-daily-photo','coursework','learning-note','project','task','reminder','support-thread','run','grocery','meal','coop-role']);

const labels={'private-note':'Note','private-friend':'Friend','private-note-folder':'Notes folder',task:'Academic task',coursework:'Saved academic work','learning-note':'Learning note',project:'Project',reminder:'Reminder','support-thread':'Chat',run:'Run',grocery:'Grocery item',meal:'Saved meal','coop-role':'Co-op role','prayer-note':'Prayer request','private-journal':'Journal entry','private-journal-template':'Journal template','private-daily-photo':'Daily photo','prayer-session':'Prayer recording',lecture:'Lecture notes and audio',devotional:'Devotional'};

function selection(kind,id){

 const clauses=['(kind=? AND id=?)'],args=[kind,id];

 const linked=(kinds,field)=>{clauses.push(`(kind IN (${kinds.map(()=>'?').join(',')}) AND json_extract(data,?)=?)`);args.push(...kinds,'$.'+field,id);};

 if(kind==='lecture'){clauses.push("(kind IN ('lecture-capture','lecture-layout') AND id=?)");args.push(id);linked(['lecture-page','lecture-ink','lecture-ink-patch','lecture-layout','lecture-study-item','lecture-photo','lecture-clip','lecture-capture','support-thread'],'lectureId');clauses.push("(kind>='lecture-' AND kind<'lecture.' AND (json_extract(data,'$.lectureId')=? OR (id>=? AND id<?)))");args.push(id,id+'-p-',id+'-p.');}

 if(kind==='devotional'){linked(['spiritual','accountability-draft','devotional-step'],'entryId');}

 if(kind==='private-friend'){linked(['private-contact-completion'],'friendId');linked(['private-note-image'],'ownerId');}
 if(kind==='private-note')linked(['private-note-image'],'ownerId');
 if(kind==='prayer-session')linked(['spiritual','prayer-date-correction'],'sessionId');

 if(['prayer-session','lecture','coursework'].includes(kind)){clauses.push("(kind='upload-manifest' AND (id=? OR id IN (SELECT id FROM records WHERE kind='lecture-clip' AND json_extract(data,'$.lectureId')=?)))");args.push(id,id);}

 if(kind==='lecture'){clauses.push("(kind IN ('support-message','assistant-proposal') AND json_extract(data,'$.threadId') IN (SELECT id FROM records WHERE kind='support-thread' AND json_extract(data,'$.lectureId')=?))");args.push(id);}

 if(kind==='support-thread')linked(['support-message','assistant-proposal'],'threadId');

 return {where:clauses.join(' OR '),args};

}

const jobSelection=ids=>({where:['sessionId','lectureId','threadId','entryId','date','taskId','friendId'].map(field=>`json_extract(payload,'$.${field}') IN (SELECT value FROM json_each(?))`).join(' OR '),args:Array(7).fill(JSON.stringify(ids))});

function references(value,out=new Set()){

 if(!value||typeof value!=='object')return out;

 for(const [key,item] of Object.entries(value))if(typeof item==='object')references(item,out);else if(typeof item==='string'&&/^(?:objectKey|baseObjectKey|thumbnailKey|archiveId|archiveFileId|recordingId|fileId|driveId|audioFileId|key)$/.test(key)&&item.length<300)out.add(item);

 return out;

}

async function removeFile(env,file){

 try{await privateFile(env,file.drive_id,file.folder_id);}catch(e){if(e.code==='google_not_found')return;throw e;}

 await googleFetch(env,'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(file.drive_id),{method:'DELETE'});

}

export async function deletedRoute({store,env,config,req,path,body,deleteFile=removeFile}){

 if(!path.startsWith('/api/deleted'))return null;

 if(path==='/api/deleted/kinds'&&req.method==='GET')return Response.json({kinds:deletionKinds.map(id=>({id,label:labels[id]??id.replaceAll('-',' ')}))});

 if(path==='/api/deleted/candidates'&&req.method==='GET'){const q=new URL(req.url).searchParams,kind=v.enumValue(q.get('kind'),deletionKinds),after=q.get('after')||'';if(after)v.identifier(after);const found=(await store.sql("SELECT id,version,COALESCE(json_extract(data,'$.title'),json_extract(data,'$.passage'),json_extract(data,'$.name'),json_extract(data,'$.date'),json_extract(data,'$.day'),'Entry') label FROM records WHERE kind=? AND id>? ORDER BY id LIMIT 31",kind,after).all()).results;return Response.json({items:found.slice(0,30).map(r=>({...r,kind})),next:found.length>30?found[29].id:null});}



 if(path==='/api/deleted'&&req.method==='GET'){const q=new URL(req.url).searchParams,time=q.get('beforeTime'),id=q.get('beforeId');if(time){v.text(time,40);v.identifier(id);}const items=(await store.sql('SELECT id,kind,record_id,label,deleted_at,state FROM deleted_entries'+(time?' WHERE (deleted_at,id)<(?,?)':'')+' ORDER BY deleted_at DESC,id DESC LIMIT 201',...(time?[time,id]:[])).all()).results;return Response.json({items:items.slice(0,200),next:items.length>200?{beforeTime:items[199].deleted_at,beforeId:items[199].id}:null});}

 if(path==='/api/deleted'&&req.method==='POST'){

  v.exactFields(body,['kind','id','version','mutationId']);v.enumValue(body.kind,deletionKinds);v.identifier(body.id);v.version(body.version);const mid=v.mutationId(body.mutationId),fingerprint={path,body},old=await store.mutation(mid,await digest(JSON.stringify(fingerprint)));if(old)return Response.json(old);

  const root=await store.get(body.kind,body.id);if(!root)throw new AppError('Entry no longer exists',404);if(root.version!==body.version)throw new AppError('This entry changed. Reopen it before deleting.',409);

  if(root.data.recordingStatus==='recording'||root.data.captureState==='recording')throw new AppError('Finish recording before deleting this lecture.',409);

  if(body.kind==='lecture'){const capture=await store.get('lecture-capture',body.id);if(capture?.data.recorderDevice)throw new AppError('Stop and sync the lecture recorder before deleting these notes.',409);}

  const sel=selection(body.kind,body.id),size=await store.sql(`SELECT COUNT(*) count,COALESCE(SUM(length(data)),0) bytes FROM records WHERE ${sel.where}`,...sel.args).first();if(size.count>800||size.bytes>8000000)throw new AppError('This entry needs a larger recovery operation. Nothing was deleted.',413);

  const rows=(await store.sql(`SELECT * FROM records WHERE ${sel.where} ORDER BY kind,id`,...sel.args).all()).results,ids=[body.id,...rows.filter(r=>['lecture-clip','support-thread'].includes(r.kind)).map(r=>r.id)];if(ids.length>60)throw new AppError('Too many linked sessions to delete in one operation',413);

  const jobs=jobSelection(ids),refs=new Set();for(const row of rows)references(JSON.parse(row.data),refs);ids.forEach(id=>refs.add(id));

  if(refs.size>600)throw new AppError('This entry needs a larger file inventory. Nothing was deleted.',413);

  const files=new Map(),keys=[...refs];for(let i=0;i<keys.length;i+=40){const part=keys.slice(i,i+40),slots=part.map(()=>'?').join(',');for(const f of (await store.sql(`SELECT drive_id,folder_id FROM private_objects WHERE (object_key IN (${slots}) OR drive_id IN (${slots})) AND object_key NOT LIKE 'lecture-deck:%'`,...part,...part).all()).results)files.set(f.drive_id,f);}

  const prefixes=body.kind==='lecture'?['lecture-page:'+body.id+'-p-','lecture-ink:'+body.id+'-p-']:body.kind==='prayer-session'?['prayer:'+body.id+':']:body.kind==='private-daily-photo'?['daily-photo:'+body.id+':']:body.kind==='devotional'?['custom-devotional:'+body.id+':']:[];

  for(const prefix of prefixes){const found=(await store.sql('SELECT object_key,drive_id,folder_id FROM private_objects WHERE object_key>=? AND object_key<? LIMIT 2001',prefix,prefix+'\uffff').all()).results;if(found.length>2000)throw new AppError('This file history needs a larger deletion operation. Nothing was deleted.',413);for(const f of found){if(body.kind==='lecture'&&!/^\d{4}:/.test(f.object_key.slice(prefix.length)))continue;files.set(f.drive_id,{drive_id:f.drive_id,folder_id:f.folder_id});}}

  const sessions=[...new Set([...ids,...rows.map(r=>JSON.parse(r.data).recordingId).filter(Boolean)])];for(let i=0;i<sessions.length;i+=40){const part=sessions.slice(i,i+40),slots=part.map(()=>'?').join(',');for(const f of (await store.sql(`SELECT drive_id FROM chunks WHERE session_id IN (${slots}) UNION SELECT drive_id FROM upload_pending WHERE session_id IN (${slots})`,...part,...part).all()).results)files.set(f.drive_id,{...f,folder_id:config.driveFolders.uploads});}

  for(const sid of sessions){const f=await store.sql("SELECT drive_id FROM file_assembly WHERE session_id=?",sid).first();if(f)files.set(f.drive_id,{...f,folder_id:config.driveFolders.uploads});}

  for(const f of files.values())if(![config.driveFolders.uploads,config.driveFolders.archives].includes(f.folder_id))throw new AppError('A linked file belongs to a protected source folder. Nothing was deleted.',409);

  const id=crypto.randomUUID(),now=new Date().toISOString(),label=[labels[body.kind]??body.kind,root.data.title||root.data.passage||root.data.name||root.data.date||root.data.day].filter(Boolean).join(' · ').slice(0,240),result={deleted:true,id};

  const extra=[store.sql("INSERT INTO deleted_entries VALUES(?,?,?,?,?,?,'deleted')",id,body.kind,body.id,label,now,JSON.stringify([...files.values()])),store.sql(`INSERT INTO deleted_records SELECT ?,kind,id,data,version,created_at,updated_at FROM records WHERE ${sel.where}`,id,...sel.args),store.sql("INSERT INTO retired_records SELECT kind,id,? FROM deleted_records WHERE entry_id=? AND kind<>'spiritual'",id,id),store.sql(`INSERT INTO kind_revisions SELECT kind,1 FROM records WHERE ${sel.where} GROUP BY kind ON CONFLICT(kind) DO UPDATE SET version=version+1`,...sel.args),store.sql(`UPDATE jobs SET status='cancelled',cancel_requested=1,progress='Entry moved to Deleted' WHERE status='queued' AND (${jobs.where})`,...jobs.args),store.sql('DELETE FROM records WHERE EXISTS(SELECT 1 FROM deleted_records d WHERE d.entry_id=? AND d.kind=records.kind AND d.id=records.id)',id)];

  const sessionSlots=sessions.map(()=>'?').join(',');const preconditions=[store.assertion('SELECT EXISTS(SELECT 1 FROM records WHERE kind=? AND id=? AND version=?)',[body.kind,body.id,body.version]),store.assertion(`SELECT NOT EXISTS(SELECT 1 FROM upload_pending WHERE session_id IN (${sessionSlots}) AND lease_until>?)`,[...sessions,Date.now()]),store.assertion(`SELECT NOT EXISTS(SELECT 1 FROM jobs WHERE status='running' AND (${jobs.where}))`,jobs.args),store.assertion(`SELECT json_group_array(kind||':'||id||':'||version)=? FROM (SELECT kind,id,version FROM records WHERE ${sel.where} ORDER BY kind,id)`,[JSON.stringify(rows.map(r=>r.kind+':'+r.id+':'+r.version)),...sel.args])];

  extra.push(store.sql('INSERT INTO audit VALUES(?,?,?,?,?,?,?,NULL)',crypto.randomUUID(),'deletion',id,null,JSON.stringify({operation:'trash',kind:body.kind,id:body.id}),now,'owner-confirmed-deletion'));

  return Response.json(await store.commit({id:mid,fingerprint,preconditions,extra,result}));

 }

 const m=path.match(/^\/api\/deleted\/([-\w]+)\/(restore|purge)$/);if(!m||req.method!=='POST')throw new AppError('Not found',404);

 v.exactFields(body,['mutationId','confirmed']);if(body.confirmed!==true)throw new AppError('Confirm this action first',400);const mid=v.mutationId(body.mutationId),fingerprint={path,body},prior=await store.mutation(mid,await digest(JSON.stringify(fingerprint)));if(prior)return Response.json(prior);

 const item=await store.sql('SELECT * FROM deleted_entries WHERE id=?',m[1]).first();if(!item)throw new AppError('Deleted entry not found',404);

 if(m[2]==='restore'){

  if(item.state!=='deleted')throw new AppError('Permanent deletion has begun and cannot be undone.',409);

  const extra=[store.sql('DELETE FROM retired_records WHERE deletion_id=?',item.id),store.sql("INSERT INTO records SELECT kind,id,data,version+1,created_at,? FROM deleted_records d WHERE entry_id=? AND (kind<>'spiritual' OR NOT EXISTS(SELECT 1 FROM records r WHERE r.kind=d.kind AND r.id=d.id))",new Date().toISOString(),item.id),store.sql('DELETE FROM deleted_records WHERE entry_id=?',item.id),store.sql('DELETE FROM deleted_entries WHERE id=?',item.id)];

  return Response.json(await store.commit({id:mid,fingerprint,preconditions:[store.assertion("SELECT state='deleted' FROM deleted_entries WHERE id=?",[item.id])],extra,result:{restored:true,kind:item.kind,id:item.record_id}}));

 }

 // Only a confirmed human command enters this state. No scheduler calls this route.

 const locked=await store.sql("UPDATE deleted_entries SET state='purging' WHERE id=? RETURNING files",item.id).first();if(!locked)throw new AppError('Entry was restored. Nothing was permanently deleted.',409);

 const files=JSON.parse(locked.files);for(const file of files.slice(0,6)){await deleteFile(env,file);await store.db.batch([store.sql('DELETE FROM private_objects WHERE drive_id=?',file.drive_id),store.sql('DELETE FROM chunks WHERE drive_id=?',file.drive_id),store.sql('DELETE FROM upload_pending WHERE drive_id=?',file.drive_id),store.sql('DELETE FROM file_assembly WHERE drive_id=?',file.drive_id)]);files.splice(files.findIndex(f=>f.drive_id===file.drive_id),1);await store.sql('UPDATE deleted_entries SET files=? WHERE id=?',JSON.stringify(files),item.id).run();}

 if(files.length)return Response.json(await store.commit({id:mid,fingerprint,result:{purging:true,remaining:files.length}}));

 const extra=[store.sql('DELETE FROM audit WHERE EXISTS(SELECT 1 FROM deleted_records d WHERE d.entry_id=? AND d.kind=audit.kind AND d.id=audit.record_id)',item.id),store.sql('DELETE FROM deleted_records WHERE entry_id=?',item.id),store.sql('DELETE FROM deleted_entries WHERE id=?',item.id)];

 return Response.json(await store.commit({id:mid,fingerprint,extra,result:{purged:true}}));

}
