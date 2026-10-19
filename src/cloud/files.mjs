import {validatePrayerList,prayerSnapshot} from '../../public/prayer-tree.js';
import {lifeosDay} from '../../public/lifeos-day.js';
import {createHash} from 'node:crypto';import {AppError} from '../shared/errors.mjs';import {googleFetch,privateFile} from './google.mjs';import {digest} from './store.mjs';import * as v from '../server/validation.mjs';import {loadPlan,commitPlan} from './records.mjs';import {actionResult,observation} from '../shared/application.mjs';
const maxChunk=8*1024*1024;
export async function boundedBytes(req,limit){const reader=req.body?.getReader();if(!reader)return new Uint8Array();let size=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new AppError('Request exceeds size limit',413);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;}
export async function uploadChunk({store,env,config,req,sid,index,maxBytes=maxChunk}){
 v.identifier(sid);if(await store.sql("SELECT 1 FROM retired_records WHERE kind IN ('prayer-session','lecture-clip','upload-manifest','coursework') AND id=?",sid).first())throw new AppError('This recording is in Deleted. Restore it in Settings before uploading.',410,'entry_deleted');v.mutationId(req.headers.get('x-mutation-id'));if(!Number.isInteger(index)||index<0||index>10000)throw new AppError('Invalid chunk index');
 const mime=(req.headers.get('content-type')??'').split(';')[0];if(!['audio/webm','audio/mp4','audio/ogg','audio/wav','application/pdf','text/plain','image/png','image/jpeg','application/octet-stream'].includes(mime))throw new AppError('File format is not supported',415);
 const bytes=await boundedBytes(req,Math.min(maxChunk,maxBytes));if(!bytes.length)throw new AppError('Empty upload chunk');const sha=await digest(bytes);if(sha!==req.headers.get('x-content-sha256'))throw new AppError('Upload checksum does not match');
 const prior=await store.sql('SELECT * FROM chunks WHERE session_id=? AND chunk_index=?',sid,index).first();
 if(prior){if(prior.sha256!==sha||prior.mime_type!==mime||prior.size!==bytes.length)throw new AppError('A different chunk already exists',409);const file=await privateFile(env,prior.drive_id,config.driveFolders.uploads);if(Number(file.size)!==bytes.length||file.md5Checksum!==createHash('md5').update(bytes).digest('hex'))throw new AppError('Remote chunk verification failed',409);return Response.json({stored:true,sha256:sha,index});}
 if(await store.get('upload-manifest',sid))throw new AppError('Upload is already finalized',409);
 const totals=await store.sql('SELECT count(*) n,COALESCE(sum(size),0) size FROM chunks WHERE session_id=?',sid).first();if(totals.n>=10001||totals.size+bytes.length>1024*1024*1024)throw new AppError('Recording exceeds upload limit',413);
 // One private Drive file per bounded chunk. Resumable capability never leaves the server.
 let pending=await store.sql('SELECT * FROM upload_pending WHERE session_id=? AND chunk_index=?',sid,index).first();
 if(!pending){const generated=(await (await googleFetch(env,'https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive')).json()).ids[0];await store.sql('INSERT OR IGNORE INTO upload_pending(session_id,chunk_index,sha256,drive_id,size,mime_type) VALUES(?,?,?,?,?,?)',sid,index,sha,generated,bytes.length,mime).run();pending=await store.sql('SELECT * FROM upload_pending WHERE session_id=? AND chunk_index=?',sid,index).first();}
 if(pending.sha256!==sha||pending.size!==bytes.length||pending.mime_type!==mime)throw new AppError('A different chunk is already pending',409);
 const owner=crypto.randomUUID(),locked=await store.sql('UPDATE upload_pending SET lease_owner=?,lease_until=? WHERE session_id=? AND chunk_index=? AND lease_until<? RETURNING drive_id',owner,Date.now()+90000,sid,index,Date.now()).first();if(!locked)throw new AppError('This chunk is still being saved. Retry shortly.',409,'upload_busy');
 const id=pending.drive_id,md5=createHash('md5').update(bytes).digest('hex');
 try{
 // A previous response may have been lost after Drive accepted the file. Reuse its server-owned ID.
 let file;try{file=await privateFile(env,id,config.driveFolders.uploads);}catch(error){if(error.code==='file_denied')throw error;}
 if(!file){
 const init=await googleFetch(env,'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':mime,'X-Upload-Content-Length':String(bytes.length)},body:JSON.stringify({id,name:`${sid}-${index}`,parents:[config.driveFolders.uploads],appProperties:{lifeosEnvironment:env.ENVIRONMENT,sessionId:sid,chunkIndex:String(index),sha256:sha}})});
 const capability=init.headers.get('location');if(!capability)throw new AppError('Remote upload could not start',503);
 await store.sql('UPDATE upload_pending SET capability=? WHERE session_id=? AND chunk_index=? AND lease_owner=?',capability,sid,index,owner).run();
 const uploaded=await googleFetch(env,capability,{method:'PUT',headers:{'Content-Type':mime,'Content-Range':`bytes 0-${bytes.length-1}/${bytes.length}`},body:bytes});if(uploaded.status===308)throw new AppError('Remote upload is incomplete',503);
 file=await privateFile(env,id,config.driveFolders.uploads);
 }
 if(Number(file.size)!==bytes.length||file.md5Checksum!==md5)throw new AppError('Remote checksum verification failed',503);
 await store.db.batch([store.assertion("SELECT NOT EXISTS(SELECT 1 FROM records WHERE kind='upload-manifest' AND id=?)",[sid]),store.assertion('SELECT COALESCE(sum(size),0)+?<=1073741824 FROM chunks WHERE session_id=?',[bytes.length,sid]),store.sql('INSERT INTO chunks VALUES(?,?,?,?,?,?)',sid,index,sha,id,bytes.length,mime),store.sql('DELETE FROM upload_pending WHERE session_id=? AND chunk_index=? AND lease_owner=?',sid,index,owner),store.sql('DELETE FROM assertions')]);
 return Response.json({stored:true,sha256:sha,index});
 }finally{await store.sql('UPDATE upload_pending SET lease_until=0,lease_owner=NULL WHERE session_id=? AND chunk_index=? AND lease_owner=?',sid,index,owner).run();}
}
// Read-only receipt reconciliation. Never change existing audio, metadata or jobs.
export async function reconcileFinalizedUpload({store,body}){
 v.exactFields(body,['sessionId','kind','totalChunks']);const sid=v.identifier(body.sessionId);v.enumValue(body.kind,['prayer','coursework','attachment']);v.number(body.totalChunks,1,10001);
 const expected=body.kind==='prayer'?'prayer-session':body.kind,manifest=await store.get('upload-manifest',sid),item=await store.get(expected,sid);
 if(!manifest?.data.cloudChunks||manifest.data.recordKind!==expected||!item||item.data.uploadStatus!=='stored'||item.data.chunks!==body.totalChunks)throw new AppError('No matching finalized upload receipt. Keep this request for review.',409);
 const chunks=await store.sql('SELECT count(*) n,COALESCE(sum(size),0) bytes,MIN(chunk_index) first,MAX(chunk_index) last FROM chunks WHERE session_id=?',sid).first();
 if(chunks.n!==body.totalChunks||chunks.first!==0||chunks.last!==body.totalChunks-1||chunks.bytes!==item.data.bytes)throw new AppError('The saved file needs recovery. Keep this request.',409);
 return Response.json({reconciled:true,sessionId:sid,recordKind:expected,bytes:item.data.bytes,sha256:item.data.sha256});
}
export async function finalizeUpload({store,config,body,path}){
 const sid=v.identifier(body.sessionId),total=v.number(body.totalChunks,1,10001);if(!Number.isInteger(total))throw new AppError('Whole chunk count required');v.enumValue(body.kind,['prayer','coursework','attachment']);
 const prior=await store.mutation(v.mutationId(body.mutationId),await digest(JSON.stringify({path,body})));if(prior)return Response.json(prior);
 const chunks=(await store.sql('SELECT * FROM chunks WHERE session_id=? ORDER BY chunk_index LIMIT 10002',sid).all()).results;
 if(chunks.length!==total||chunks.some((r,i)=>r.chunk_index!==i))throw new AppError('Some chunks have not reached cloud storage',409,'upload_incomplete');
 const mime=chunks[0].mime_type,size=chunks.reduce((s,r)=>s+r.size,0);if(chunks.some(r=>r.mime_type!==mime)||body.mimeType&&body.mimeType.split(';')[0]!==mime)throw new AppError('Upload formats disagree');if(size>(body.kind==='prayer'?1024*1024*1024:50*1024*1024))throw new AppError('File exceeds size limit',413);
 const sections=body.sections??[];if(!Array.isArray(sections)||sections.length>500)throw new AppError('Invalid recording sections');for(const m of sections){v.exactFields(m,['section','atMs']);if(!Number.isInteger(m.section))throw new AppError('Invalid section');v.number(m.section,0,5);v.number(m.atMs,0,86400000);}
 const title=v.text(body.title??'Recording',300),taskId=body.taskId?v.identifier(body.taskId):null;
 const plan=await loadPlan(store,['prayer-session','coursework','attachment','upload-manifest','task','settings','spiritual']);if(taskId&&!plan.get('task',taskId))throw new AppError('Task not found',404);
 let snapshot=null;if(body.kind==='prayer'&&body.prayerSnapshot){try{snapshot={...body.prayerSnapshot,sections:validatePrayerList(body.prayerSnapshot.sections)};if(JSON.stringify(snapshot).length>180000)throw Error();}catch{throw new AppError('Invalid prayer-list snapshot');}}
 const fingerprint=await digest(JSON.stringify({prayerSnapshot:snapshot,kind:body.kind,total,title,taskId,sections,startedAt:body.startedAt??null,endedAt:body.endedAt??null}));
 const finalized=plan.get('upload-manifest',sid);
 if(finalized){
  if(finalized.data.fingerprint!==fingerprint)throw new AppError('This recording was already finalized with different metadata',409);
  const item=plan.get(finalized.data.recordKind,sid);
  if(!item)throw new AppError('Saved recording metadata needs recovery',409);
  const job=finalized.data.jobId?await store.sql('SELECT id,type,status FROM jobs WHERE id=?',finalized.data.jobId).first():null;
  return Response.json({item,job,replayed:true});
 }
 const startedAt=body.startedAt?observation(body.startedAt,null,plan):null,endedAt=body.endedAt?observation(body.endedAt,null,plan):null;if(startedAt&&endedAt&&endedAt<startedAt)throw new AppError('Recording end precedes start');
 const p={sid,total,title,taskId,sections,mime,size,sha256:await digest(chunks.map(c=>c.sha256).join('')),destination:null,fingerprint,startedAt,endedAt};
 const result=actionResult('upload-finalize',body,plan,config,p);if(total>20)plan.queued.push({id:crypto.randomUUID(),type:'file-assemble',payload:{sessionId:sid},priority:5,component:'cloud',authority:'remote-file-assembly'});
 const manifest=plan.changes.find(c=>c.kind==='upload-manifest');manifest.after.data.cloudChunks=true;manifest.after.data.checksumFormat='ordered-sha256-manifest-v1';delete manifest.after.data.assembledPath;
 const item=plan.changes.find(c=>c.id===sid&&c.kind!=='upload-manifest');item.after.data.downloadUrl='/api/files/'+sid;item.after.data.checksumFormat='ordered-sha256-manifest-v1';item.after.data.prayerSnapshot=snapshot;result.item=item.after;
 // Saving a recording is not a declaration that the day's prayer is complete.
 // The explicit Complete prayer action owns that decision.
 const extra=[store.assertion('SELECT count(*)=? FROM chunks WHERE session_id=?',[total,sid])];
 return Response.json(await commitPlan(store,plan,{id:body.mutationId,fingerprint:{path,body},result,extra}));
}
export async function downloadFile({store,env,config,id}){
 const manifest=await store.get('upload-manifest',v.identifier(id));if(!manifest?.data.cloudChunks)throw new AppError('Remote file unavailable',404);
 const chunks=(await store.sql('SELECT * FROM chunks WHERE session_id=? ORDER BY chunk_index',id).all()).results;if(!chunks.length)throw new AppError('File unavailable',404);
 // Limit one response to the Workers Free subrequest budget. Larger recordings are read as bounded chunks by the local worker.
 if(chunks.length>20){const assembled=await store.sql("SELECT * FROM file_assembly WHERE session_id=? AND state='verified'",id).first();if(!assembled)throw new AppError('The recording is remotely saved. Its combined download is still being prepared.',409,'assembly_pending');await privateFile(env,assembled.drive_id,config.driveFolders.uploads);return new Response((await googleFetch(env,`https://www.googleapis.com/drive/v3/files/${assembled.drive_id}?alt=media`)).body,{headers:{'Content-Type':assembled.mime_type,'Content-Length':String(assembled.total_size),'Content-Disposition':'attachment; filename=lifeos-recording','Content-Security-Policy':"default-src 'none'; sandbox"}});}
 let index=0,reader=null;
 const stream=new ReadableStream({async pull(controller){try{for(;;){if(!reader){if(index>=chunks.length){controller.close();return;}const c=chunks[index++];await privateFile(env,c.drive_id,config.driveFolders.uploads);reader=(await googleFetch(env,`https://www.googleapis.com/drive/v3/files/${c.drive_id}?alt=media`)).body.getReader();}const next=await reader.read();if(next.done){reader=null;continue;}controller.enqueue(next.value);return;}}catch(e){controller.error(e);}},async cancel(){await reader?.cancel();}});
 return new Response(stream,{headers:{'Content-Type':manifest.data.mimeType,'Content-Disposition':`attachment; filename="lifeos-file"; filename*=UTF-8''${encodeURIComponent(manifest.data.title)}`,'Content-Security-Policy':"default-src 'none'; sandbox"}});
}
