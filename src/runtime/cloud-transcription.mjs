import {httpsOrigin} from '../shared/service-config.mjs';
import {organizeFriendContext} from '../integrations/local-friend-context.mjs';
import {PRAYER_SUMMARY_VERSION,summarizePrayer} from '../integrations/local-prayer-summary.mjs';
import {prayerSnapshot} from '../../public/prayer-tree.js';
import {lifeosDay} from '../../public/lifeos-day.js';
import {readFile,mkdir,open,link,unlink,readdir,realpath,lstat,mkdtemp} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import {resolve,join,relative,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {unprotect} from '../server/secrets.mjs';
import {processPrayerAudio,renderPrayerJournal} from '../integrations/prayer.mjs';
import {privateFailureReport} from '../shared/private-processing.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fault=code=>Object.assign(Error(code),{code});
const check=signal=>{if(signal?.aborted)throw fault('local_inference_aborted');};
async function directory(path){
 try{
 await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);
 if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid()||await realpath(path)!==path)throw fault('private_storage_unavailable');
 // This worker owns its local recovery directories; contents are never logged.
 const handle=await open(path,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);try{await handle.chmod(0o700);}finally{await handle.close();}
 }catch{throw fault('private_storage_unavailable');}
}
async function privateBytes(path,limit=64*1024*1024){
 let handle;
 try{
  handle=await open(path,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);const before=await handle.stat();
  if(!before.isFile()||before.uid!==process.getuid()||before.size>limit||(before.mode&0o022))throw fault('private_storage_unavailable');
  const buffer=Buffer.alloc(before.size+1);let count=0;
  while(count<buffer.length){const next=await handle.read(buffer,count,buffer.length-count,null);if(!next.bytesRead)break;count+=next.bytesRead;}
  const after=await handle.stat();if(count!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw fault('private_storage_unavailable');
  return buffer.subarray(0,count);
 }finally{await handle?.close();}
}
async function savePrivate(path,bytes){
 if(bytes.length>64*1024*1024)throw fault('private_storage_unavailable');
 const pending=path+'.'+randomUUID()+'.pending',handle=await open(pending,'wx',0o600);
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 // A finalized file is visible atomically and can never replace an original.
 try{await link(pending,path);}finally{await unlink(pending).catch(()=>{});}
 if(sha(await privateBytes(path))!==sha(bytes))throw fault('private_storage_unavailable');
 const parent=await open(resolve(path,'..'),fsConstants.O_RDONLY);try{await parent.sync();}finally{await parent.close();}
}
async function bindOrigin(root,origin){
 const path=join(root,'worker-origin.json');
 try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await privateBytes(path,4096)));if(value.schemaVersion!==1||value.origin!==origin)throw fault('private_storage_scope_mismatch');}
 catch(error){if(error.code!=='ENOENT')throw error;await savePrivate(path,Buffer.from(JSON.stringify({schemaVersion:1,origin})));}
}
function hasSpeech(result,sessionId){return result&&(!result.sessionId||result.sessionId===sessionId)&&typeof result.rawTranscript==='string'&&typeof result.cleanedTranscript==='string'&&Array.isArray(result.sections)&&Array.isArray(result.unassigned)&&Array.isArray(result.qualityFlags);}
function completedResult(result,{requireProcessed=false,summaryRequired=false}={}){return (!requireProcessed||result?.processingStatus==='transcribed-needs-review')&&(!summaryRequired||result?.provenance?.summaryVersion===PRAYER_SUMMARY_VERSION);}
async function artifactsIntact(result,root){
 for(const name of ['transcript','journal','recognition']){
  const item=result.artifacts?.[name];if(!item?.durable||typeof item.path!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256??''))return false;
  const rel=relative(root,item.path);if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||await realpath(item.path)!==item.path)return false;
  if(sha(await privateBytes(item.path))!==item.sha256)return false;
 }
 return true;
}
async function saveCache(root,kind,basis,sessionId,result){
 if(!hasSpeech(result,sessionId))throw fault('private_result_invalid');
 const bytes=Buffer.from(JSON.stringify({schemaVersion:1,kind,basis,sessionId,result}));
 await savePrivate(join(root,`${kind}-${basis}-${sha(bytes)}-${randomUUID()}.json`),bytes);
}
async function loadCache(root,kind,basis,sessionId,{verifyArtifacts=false,requireProcessed=false,summaryRequired=false}={}){
 const files=await readdir(root);if(files.length>10000)throw fault('private_storage_unavailable');
 for(const file of files.sort()){
  const match=file.match(/^(recognized|completed)-([a-f0-9]{64})-([a-f0-9]{64})-([a-f0-9-]{36})\.json$/);
  if(!match||match[1]!==kind||match[2]!==basis)continue;
  try{
   const bytes=await privateBytes(join(root,file));if(sha(bytes)!==match[3])continue;
   const cached=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(cached.schemaVersion!==1||cached.kind!==kind||cached.basis!==basis||cached.sessionId!==sessionId||!hasSpeech(cached.result,sessionId))continue;
   if(verifyArtifacts&&!await artifactsIntact(cached.result,root))continue;
   if(kind==='recognized'&&cached.result.processingStatus!=='recognized-needs-summary')continue;
   if(kind==='completed'&&!completedResult(cached.result,{requireProcessed,summaryRequired}))continue;
   return cached.result;
  }catch{ /* Preserve corrupt/incomplete recovery files; never publish them. */ }
 }
 // Old validated-result files have no origin attestation. Preserve them, but
 // never retroactively bind them to a new marker or publish their contents.
 return null;
}
async function finishRecognition(result,{outputRoot,localSummary,signal,summarize}){
 check(signal);let output=localSummary?.enabled?await summarize(result,{...localSummary,signal}):structuredClone(result);
 check(signal);
 const summaryRoot=await mkdtemp(join(outputRoot,'summary-')),path=join(summaryRoot,'journal.md'),bytes=Buffer.from(renderPrayerJournal(output));await savePrivate(path,bytes);
 output={...output,artifacts:{...output.artifacts,journal:{path,sha256:sha(bytes),durable:true,archiveId:null,readbackSha256:null}},processingStatus:'transcribed-needs-review',completionChanged:false};
 await savePrivate(join(summaryRoot,'result.json'),Buffer.from(JSON.stringify(output)));return output;
}
export async function resummarizeSavedPrayer({session,summarize=summarizePrayer,signal}){
 const result=session?.data.processingResult;
 if(!result||typeof result.rawTranscript!=='string'||!Array.isArray(result.sections))throw Error('Saved recognition is unavailable. Keep the original recording for recovery.');
 return summarize(result,{signal});
}
const sleep=(ms,signal)=>new Promise(resolve=>{if(signal.aborted)return resolve();const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();},timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});});

export async function runCloudTranscription(config,options={}){
 try{return await runPrivateWorker(config,options);}catch(error){throw fault(['private_worker_origin_denied','private_worker_scope_mismatch','private_worker_configuration_invalid','private_worker_credential_unavailable','private_storage_unavailable'].includes(error?.code)?error.code:'private_worker_unavailable');}
}
async function runPrivateWorker(config,{once=false,processAudio=processPrayerAudio,fetchImpl=fetch,loadSecret=unprotect,organizeFriends=organizeFriendContext,summarize=summarizePrayer,signal,leaseIntervalMs=20000,waitImpl=sleep}={}){
 let origin;try{origin=httpsOrigin(process.env.LIFEOS_CLOUD_ORIGIN??config.origin);}catch{throw fault('private_worker_origin_denied');}
 config={...config,origin};
 if(!Number.isInteger(leaseIntervalMs)||leaseIntervalMs<1||leaseIntervalMs>20000)throw fault('private_worker_configuration_invalid');
 if(signal?.aborted)return;
 const secret=await Promise.resolve().then(()=>loadSecret(config.workerTokenFile)).catch(()=>{throw fault('private_worker_credential_unavailable');});let secretOrigin;try{secretOrigin=httpsOrigin(secret?.origin);}catch{throw fault('private_worker_scope_mismatch');}if(secretOrigin!==config.origin||secret?.component!=='transcription')throw fault('private_worker_scope_mismatch');
 let activeController,stopping=false,failures=0;const runStop=new AbortController();
 const stop=()=>{stopping=true;runStop.abort();activeController?.abort();};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);signal?.addEventListener('abort',stop,{once:true});
 if(signal?.aborted)stop();
 const call=async(path,body={},binary=false,claimToken)=>{
  const response=await fetchImpl(config.origin+'/api/worker/'+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+secret.token,'Content-Type':'application/json'},body:JSON.stringify({...body,friendContextVersion:1,...(body.jobId?{claimToken}:{})})});
  if(!response.ok){let code;try{code=(await response.json()).code;}catch{}throw fault(['lease_lost','stale_result'].includes(code)?code:'private_cloud_request_failed');}
  return binary?response:response.json();
 };
 try{await directory(resolve(config.dataDir));do{
  try{
   if(stopping)break;await call('heartbeat',{status:'idle'});if(stopping)break;
   const claimed=await call('claim');
   if(claimed.job){
    const {job,input,claimToken}=claimed;if(!/^[\w-]{1,100}$/.test(job.id))throw fault('private_job_invalid');
    const controller=new AbortController();activeController=controller;if(stopping)controller.abort();const jobSignal=controller.signal;
    const jobCall=(path,body={},binary=false)=>call(path,{jobId:job.id,...body},binary,claimToken);
    const root=join(resolve(config.dataDir),job.id),chunkRoot=join(root,'chunks'),outputRoot=join(root,'results');
    let timer,leasePending=false;
    try{
     await directory(root);await bindOrigin(root,config.origin);await directory(chunkRoot);await directory(outputRoot);check(jobSignal);
     timer=setInterval(()=>{if(leasePending||jobSignal.aborted)return;leasePending=true;jobCall('lease').then(value=>{if(value.active!==true)controller.abort();},()=>controller.abort()).finally(()=>{leasePending=false;});},leaseIntervalMs);
     await call('heartbeat',{status:'running'});check(jobSignal);
     if(job.type==='friend-process'){
      const images=[];for(const imageId of input.source.data.imageIds??[]){check(jobSignal);images.push((await jobCall('friend-image',{imageId})).image);}check(jobSignal);
      const result=await organizeFriends({...input,images},{signal:jobSignal});check(jobSignal);await jobCall('result',{response:{result}});
     }else if(job.payload.summaryOnly===true){
      const session=input.records.find(r=>r.kind==='prayer-session'&&r.id===job.payload.sessionId);
      const basis=sha(JSON.stringify({schemaVersion:1,origin:config.origin,summaryOnly:true,sessionId:session?.id,revisions:input.revisions,result:session?.data.processingResult,summaryVersion:PRAYER_SUMMARY_VERSION}));
      let result=await loadCache(root,'completed',basis,session?.id,{summaryRequired:true});
      if(!result){check(jobSignal);result=await resummarizeSavedPrayer({session,summarize,signal:jobSignal});if(!completedResult(result,{summaryRequired:true}))throw fault('private_result_invalid');await saveCache(root,'completed',basis,session.id,result);}
      check(jobSignal);await jobCall('result',{response:{result}});
     }else{
      let offset=0,metadata=[];
      do{check(jobSignal);const page=await jobCall('file-manifest',{offset});if(!Array.isArray(page.chunks)||page.next!==null&&(!Number.isInteger(page.next)||page.next<=offset))throw fault('private_manifest_invalid');metadata.push(...page.chunks);offset=page.next;if(metadata.length>10001)throw fault('private_manifest_invalid');}while(offset!==null);
      check(jobSignal);let total=0;const chunks=[];
      for(const item of metadata){
       if(item.chunkIndex!==chunks.length||!Number.isSafeInteger(item.size)||item.size<1||item.size>8*1024*1024||!/^[a-f0-9]{64}$/.test(item.sha256))throw fault('private_manifest_invalid');
       total+=item.size;if(total>1024**3)throw fault('private_manifest_invalid');
       let path=join(chunkRoot,item.chunkIndex+'-'+item.sha256+'.media'),bytes;
       const stored=await readdir(chunkRoot);if(stored.length>10001)throw fault('private_storage_unavailable');
       const matches=stored.filter(file=>file.startsWith(item.chunkIndex+'-'+item.sha256+'-')&&/^[0-9]+-[a-f0-9]{64}-[a-f0-9-]{36}\.media$/.test(file)).sort().map(file=>join(chunkRoot,file));
       for(const candidate of [path,join(chunkRoot,item.chunkIndex+'.media'),...matches])try{const found=await privateBytes(candidate,8*1024*1024);if(found.length===item.size&&sha(found)===item.sha256){bytes=found;path=candidate;break;}}catch{}
       if(!bytes){
        check(jobSignal);const response=await jobCall('file-chunk',{chunkIndex:item.chunkIndex},true),reader=response.body.getReader(),parts=[];let count=0;
        try{for(;;){const next=await reader.read();if(next.done)break;count+=next.value.length;if(count>item.size)throw fault('private_audio_invalid');parts.push(next.value);}}finally{await reader.cancel().catch(()=>{});}
        bytes=Buffer.concat(parts);if(bytes.length!==item.size||sha(bytes)!==item.sha256)throw fault('private_audio_invalid');
        // Changed/corrupt older chunks are preserved, rather than overwritten.
        path=join(chunkRoot,item.chunkIndex+'-'+item.sha256+'-'+randomUUID()+'.media');await savePrivate(path,bytes);
       }
       chunks.push({index:item.chunkIndex,bytes:item.size,sha256:item.sha256,path});check(jobSignal);
      }
      const session=input.records.find(r=>r.kind==='prayer-session'&&r.id===job.payload.sessionId);if(!session)throw fault('private_input_invalid');
      const sectionMarkers=session.data.sections??[],plannedNotes=session.data.prayerSnapshot?prayerSnapshot(session.data.prayerSnapshot.sections,new Date(lifeosDay(session.data.startedAt)+'T12:00:00Z').getUTCDay()):input.records.filter(r=>r.kind==='prayer-note'),snapshotBasis=session.data.prayerSnapshot?'recording-snapshot':'legacy-processing-snapshot';
      const {localSummary,...recognitionConfig}=config.transcription??{};
      const recognitionBasis=sha(JSON.stringify({schemaVersion:1,origin:config.origin,sessionId:session.id,revisions:input.revisions,chunks:metadata,recognitionConfig,sectionMarkers,plannedNotes,snapshotBasis}));
      const completedBasis=sha(JSON.stringify([recognitionBasis,localSummary,PRAYER_SUMMARY_VERSION]));
      const completedChecks={requireProcessed:true,summaryRequired:localSummary?.enabled===true};
      let result=await loadCache(root,'completed',completedBasis,session.id,{verifyArtifacts:true,...completedChecks});
      if(!result){
       const checkpoint=await loadCache(root,'recognized',recognitionBasis,session.id,{verifyArtifacts:true});check(jobSignal);
       if(checkpoint)result=await finishRecognition(checkpoint,{outputRoot,localSummary,signal:jobSignal,summarize});
       else result=await processAudio({sessionId:session.id,chunks,storageRoot:root,outputRoot,...config.transcription,sectionMarkers,plannedNotes,snapshotBasis,signal:jobSignal,onRecognized:checkpoint=>saveCache(root,'recognized',recognitionBasis,session.id,checkpoint)});
       if(!completedResult(result,completedChecks))throw fault('private_result_invalid');
       await saveCache(root,'completed',completedBasis,session.id,result);
      }
      check(jobSignal);await jobCall('result',{response:{result}});
     }
    }catch(error){await jobCall('fail',privateFailureReport(error?.code==='local_inference_uncertain'?error:jobSignal.aborted?fault('local_inference_aborted'):error)).catch(()=>{});}
    finally{clearInterval(timer);if(activeController===controller)activeController=null;}
   }
   failures=0;
  }catch{failures=Math.min(failures+1,5);}
  if(!once&&!stopping)await waitImpl(Math.min(60000,30000*2**failures),runStop.signal);
 }while(!once&&!stopping);
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);signal?.removeEventListener('abort',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const config=JSON.parse(await readFile(resolve(process.env.LIFEOS_CONFIG??'.lifeos/cloud-beta/transcription.json'),'utf8'));await runCloudTranscription(config,{once:process.argv.includes('--once')});}
 catch(error){const code=['private_worker_origin_denied','private_worker_scope_mismatch','private_worker_configuration_invalid','private_worker_credential_unavailable','private_storage_unavailable','private_worker_unavailable'].includes(error?.code)?error.code:'private_worker_configuration_unavailable';process.stderr.write(code+'\n');process.exitCode=1;}
}
