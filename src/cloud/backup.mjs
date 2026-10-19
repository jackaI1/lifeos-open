import {createHash} from 'node:crypto';import {googleFetch,privateFile} from './google.mjs';import {AppError} from '../shared/errors.mjs';
import {boundedBytes} from './files.mjs';
const tables={records:['kind','id','data','version','created_at','updated_at'],audit:['id','kind','record_id','before_json','after_json','created_at','actor','undo_of'],mutations:['id','fingerprint','result','created_at'],jobs:['id','type','payload','status','priority','attempts','max_attempts','available_at','lease_until','lease_owner','created_at','updated_at','result','error','progress','cancel_requested','authority','dedupe_key','component'],chunks:['session_id','chunk_index','sha256','drive_id','size','mime_type'],source_catalogue:['id','url','title','status','content_hash','checked_at','last_success','interpreted_at','cursor','data']};
tables.private_objects=['object_key','drive_id','sha256','size','mime_type','folder_id','verified'];tables.meta=['key','value'];tables.ai_usage=['id','category','model','started_at','ended_at','before_json','after_json','result'];
tables.upload_pending=['session_id','chunk_index','sha256','drive_id','size','mime_type','capability','lease_owner','lease_until'];
tables.file_assembly=['session_id','drive_id','total_size','chunk_count','mime_type','state','capability','uploaded_offset','next_chunk','carry','pending_end','pending_state','verify_index','verify_offset'];
const backupColumn=(table,column)=>table==='upload_pending'&&['capability','lease_owner'].includes(column)||table==='file_assembly'&&['capability','carry','pending_end','pending_state'].includes(column)?'NULL':table==='upload_pending'&&column==='lease_until'?'0':table==='file_assembly'&&['uploaded_offset','next_chunk'].includes(column)?`CASE WHEN state='uploading' THEN 0 ELSE ${column} END`:column;
export async function snapshotDatabase(store,id){
 const prior=await store.meta('backup:'+id);if(prior)return prior;
 const state={schemaVersion:1,id,at:new Date().toISOString(),cursor:0,page:0,complete:false};
 // Each SELECT runs in the same D1 transaction. Later pages read this immutable snapshot, not changing live rows.
 await store.db.batch([store.assertion('SELECT NOT EXISTS(SELECT 1 FROM meta WHERE key=?)',['backup:'+id]),...Object.entries(tables).map(([table,columns])=>store.sql(`INSERT INTO backup_rows(snapshot,table_name,value) SELECT ?,?,json_object(${columns.map(c=>`'${c}',${backupColumn(table,c)}`).join(',')}) FROM ${table}${table==='meta'?" WHERE key NOT IN ('cloud-lease','migration-quiesced','quota-telemetry') AND key NOT LIKE 'backup:%'":''}`,id,table)),store.sql('INSERT INTO meta VALUES(?,?)','backup:'+id,JSON.stringify(state)),store.sql('DELETE FROM assertions')]);return state;
}
export async function backupSlice({store,env,config,job}){
 const state=await snapshotDatabase(store,job.id);if(state.complete)return cleanupBackupSlice(store,job.id,state);
 const rows=(await store.sql('SELECT sequence,table_name,value FROM backup_rows WHERE snapshot=? AND sequence>? ORDER BY sequence LIMIT 30',job.id,state.cursor).all()).results;
 if(!rows.length){const files=(await store.sql('SELECT page,drive_id,sha256,last_sequence,verified FROM backup_files WHERE snapshot=? AND page>=0 ORDER BY page',job.id).all()).results;if(files.some(f=>!f.verified))throw new AppError('Backup read-back is incomplete',503);const counts=(await store.sql('SELECT table_name,count(*) count FROM backup_rows WHERE snapshot=? GROUP BY table_name',job.id).all()).results;const manifest=JSON.stringify({schemaVersion:1,environment:env.ENVIRONMENT,snapshot:job.id,capturedAt:state.at,complete:true,files,counts});const verified=await persistBackupBytes({store,env,config,snapshot:job.id,page:-1,lastSequence:state.cursor,body:new TextEncoder().encode(manifest)});state.complete=true;state.completedAt=new Date().toISOString();state.manifest=verified;state.files=files;await store.sql('UPDATE meta SET value=? WHERE key=?',JSON.stringify(state),'backup:'+job.id).run();return cleanupBackupSlice(store,job.id,state);}
 let bytes=0,page=[];for(const row of rows){const n=new TextEncoder().encode(row.value).length;if(page.length&&bytes+n>1024*1024)break;bytes+=n;page.push(row);}if(bytes>2*1024*1024)throw new AppError('Backup row exceeds the bounded export size',413);
 const text=JSON.stringify({schemaVersion:1,environment:env.ENVIRONMENT,snapshot:job.id,capturedAt:state.at,page:state.page,rows:page.map(r=>({table:r.table_name,value:JSON.parse(r.value)}))}),body=new TextEncoder().encode(text);
 await persistBackupBytes({store,env,config,snapshot:job.id,page:state.page,lastSequence:page.at(-1).sequence,body});
 state.cursor=page.at(-1).sequence;state.page++;
 await store.sql('UPDATE meta SET value=? WHERE key=?',JSON.stringify(state),'backup:'+job.id).run();return {complete:false,verifiedPage:state.page,cursor:state.cursor};
}
export async function cleanupBackupSlice(store,id,state){
 if(state.id!==id||state.complete!==true||state.manifest?.verified!==true)throw new AppError('Backup must be verified before staging cleanup',503);
 const result={complete:true,verified:true,files:state.files?.length??state.page,manifest:state.manifest};
 if(state.cleanupComplete)return result;
 const receipt=await store.sql('SELECT drive_id,sha256,verified FROM backup_files WHERE snapshot=? AND page=-1',id).first();
 if(receipt?.verified!==1||receipt.drive_id!==state.manifest.driveId||receipt.sha256!==state.manifest.sha256)throw new AppError('Verified backup manifest receipt is missing',503);
 // backup_page(snapshot,sequence) bounds reads even when unrelated unfinished snapshots are large.
 const deleted=await store.sql('DELETE FROM backup_rows WHERE sequence IN (SELECT sequence FROM backup_rows WHERE snapshot=? ORDER BY sequence LIMIT 100)',id).run();
 if(deleted.meta.changes===100)return {...result,complete:false,cleanupPending:true};
 state.cleanupComplete=true;await store.sql('UPDATE meta SET value=? WHERE key=?',JSON.stringify(state),'backup:'+id).run();
 return result;
}
async function persistBackupBytes({store,env,config,snapshot,page,lastSequence,body}){
 const sha=createHash('sha256').update(body).digest('hex'),md5=createHash('md5').update(body).digest('hex');
 let receipt=await store.sql('SELECT * FROM backup_files WHERE snapshot=? AND page=?',snapshot,page).first();
 if(!receipt){const id=(await(await googleFetch(env,'https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive')).json()).ids[0];await store.sql('INSERT INTO backup_files VALUES(?,?,?,?,?,0)',snapshot,page,id,sha,lastSequence).run();receipt={drive_id:id,sha256:sha};}
 if(receipt.sha256!==sha)throw new AppError('Immutable backup page changed',409);
 let file;try{file=await privateFile(env,receipt.drive_id,config.driveFolders.backups);}catch(error){if(error.code==='file_denied')throw error;}
 if(!file){const init=await googleFetch(env,'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/json','X-Upload-Content-Length':String(body.length)},body:JSON.stringify({id:receipt.drive_id,name:`lifeos-${env.ENVIRONMENT}-${snapshot}-${page===-1?'manifest':page}.json`,parents:[config.driveFolders.backups],appProperties:{lifeosEnvironment:env.ENVIRONMENT,snapshot,page:String(page),sha256:sha}})});const target=init.headers.get('location');if(!target)throw new AppError('Backup upload could not start',503);await googleFetch(env,target,{method:'PUT',headers:{'Content-Type':'application/json'},body});file=await privateFile(env,receipt.drive_id,config.driveFolders.backups);}
 if(Number(file.size)!==body.length||file.md5Checksum!==md5)throw new AppError('Backup file integrity check failed',503);
 const remote=await googleFetch(env,`https://www.googleapis.com/drive/v3/files/${receipt.drive_id}?alt=media`),downloaded=await boundedBytes(remote,body.length);if(downloaded.byteLength!==body.length||createHash('sha256').update(downloaded).digest('hex')!==sha)throw new AppError('Backup read-back differs',503);
 await store.sql('UPDATE backup_files SET verified=1 WHERE snapshot=? AND page=?',snapshot,page).run();return {driveId:receipt.drive_id,sha256:sha,verified:true};
}
export function validateBackupPage(page,{environment,snapshot}){if(page.schemaVersion!==1||page.environment!==environment||page.snapshot!==snapshot||!Array.isArray(page.rows)||page.rows.length>30)throw Error('Backup scope or schema mismatch');for(const row of page.rows){const columns=tables[row.table];if(!columns||Object.keys(row.value).length!==columns.length||Object.keys(row.value).some(k=>!columns.includes(k)))throw Error('Backup row contains unsupported fields');}return page.rows;}
