import {createHash,randomUUID} from 'node:crypto';
import {mkdir,lstat,realpath,open,link,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname,basename,resolve} from 'node:path';
import {captureCookingHelpIntent,createCookingHelpRequest,validateCookingHelpResult} from '../shared/cooking-help-contract.mjs';
import {localChat} from './local-chat.mjs';
import {withLocalInference,LocalInferenceSettledFailure} from './local-inference-gate.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid=()=>Object.assign(Error('cooking_help_delivery_invalid'),{code:'cooking_help_delivery_invalid'});
const keeperFailure=()=>Object.assign(Error('cooking_help_keeper_failed'),{code:'cooking_help_keeper_failed'});
const endpoint='http://127.0.0.1:11434/api/chat';

function capture(claim){
 try{
  const intent=captureCookingHelpIntent(claim.input.intent),body=createCookingHelpRequest(intent),input=claim.input;
  if(claim.job.id!==intent.requestId||claim.job.type!=='cooking-help'||claim.job.authority!=='owner-cooking-help'||!uuid.test(claim.claimToken)||input.intentHash!==hash(intent)||input.bodyHash!==hash(body)||!Number.isSafeInteger(input.deadline)||!Number.isSafeInteger(input.serverNow)||input.deadline-input.serverNow>120000)throw invalid();
  return Object.freeze({intent,body,binding:Object.freeze({jobId:intent.requestId,claimToken:claim.claimToken,intentHash:input.intentHash,bodyHash:input.bodyHash}),deadline:input.deadline,serverNow:input.serverNow});
 }catch{throw invalid();}
}

async function directory(root,{create=false}={}){
 if(typeof root!=='string'||resolve(root)!==root)throw keeperFailure();
 if(create)await mkdir(root,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw keeperFailure();});
 const st=await lstat(root);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o777)!==0o700||await realpath(root)!==root)throw keeperFailure();
}
async function readTerminal(path){
 await directory(dirname(path));const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const st=await handle.stat();if(!st.isFile()||st.uid!==process.getuid()||(st.mode&0o777)!==0o600||st.nlink!==1||st.size<1||st.size>8_388_608)throw keeperFailure();return await handle.readFile('utf8');}finally{await handle.close();}
}
async function keepTerminal(root,terminal){
 await directory(root,{create:true});const bytes=JSON.stringify(terminal)+'\n';if(Buffer.byteLength(bytes)>8_388_608)throw keeperFailure();
 const final=join(root,terminal.binding.jobId+'.'+terminal.binding.claimToken+'.terminal.json'),temporary=join(root,randomUUID()+'.tmp');
 const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 try{
  try{await link(temporary,final);}catch(error){if(error.code!=='EEXIST')throw keeperFailure();}
  await unlink(temporary);if(await readTerminal(final)!==bytes)throw keeperFailure();
  const dir=await open(root,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_DIRECTORY);try{await dir.sync().catch(error=>{if(!['EINVAL','ENOTSUP'].includes(error.code))throw error;});}finally{await dir.close();}
  return final;
 }finally{await unlink(temporary).catch(()=>{});}
}

function retainedCapture(terminal,path){
 try{
  const keys=['schema','binding','intent','deadline','serverNow','invocationId','envelope','gateSettled','stopped'],bindingKeys=['jobId','claimToken','intentHash','bodyHash'];
  if(!terminal||Object.keys(terminal).length!==keys.length||keys.some(key=>!Object.hasOwn(terminal,key))||!terminal.binding||Object.keys(terminal.binding).length!==bindingKeys.length||bindingKeys.some(key=>!Object.hasOwn(terminal.binding,key))||terminal.schema!==1||!uuid.test(terminal.invocationId)||typeof terminal.gateSettled!=='boolean'||typeof terminal.stopped!=='boolean')throw keeperFailure();
  const captured=capture({job:{id:terminal.binding.jobId,type:'cooking-help',authority:'owner-cooking-help'},claimToken:terminal.binding.claimToken,input:{intent:terminal.intent,intentHash:terminal.binding.intentHash,bodyHash:terminal.binding.bodyHash,deadline:terminal.deadline,serverNow:terminal.serverNow}});
  if(path&&basename(path)!==terminal.binding.jobId+'.'+terminal.binding.claimToken+'.terminal.json')throw keeperFailure();return captured;
 }catch{throw keeperFailure();}
}
function terminalDraft(terminal,captured){
 try{
  if(terminal.envelope?.model!=='qwen3.8:27b-q4_K_M'||terminal.envelope.done!==true||terminal.envelope.done_reason==='length'||terminal.envelope.message?.thinking)throw invalid();
  return validateCookingHelpResult(JSON.parse(terminal.envelope.message.content),captured.intent);
 }catch{throw invalid();}
}

/** Delivery-only recovery. This function has no engine or model admission path. */
export async function settleCookingHelp(terminalFile,{request}={}){
 if(typeof request!=='function')throw invalid();
 let terminal;try{terminal=JSON.parse(await readTerminal(terminalFile));}catch{throw keeperFailure();}
 const captured=retainedCapture(terminal,terminalFile);
 let result;try{result=terminalDraft(terminal,captured);}catch{
  await request('fail',{...terminal.binding,reason:'local-rejected'}).catch(()=>{});
  return{status:'rejected',terminalFile,stopped:!!terminal.stopped};
 }
 if(terminal.stopped||!terminal.gateSettled)await request('fail',{...terminal.binding,reason:terminal.stopped?'local-stopped':'local-uncertain'}).catch(()=>{});
 try{const receipt=await request('result',{...terminal.binding,result});return{status:'retained',terminalFile,stopped:terminal.stopped,gateSettled:terminal.gateSettled,receipt};}
 catch{return{status:'pending-delivery',terminalFile,stopped:terminal.stopped,gateSettled:terminal.gateSettled};}
}

/** One immutable original, one native invocation. Observer abort never cancels
 * the admitted native drain; its terminal is kept before localChat checks abort.
 */
export async function deliverCookingHelp(claim,{request,signal,terminalRoot,fetchImpl=fetch,runLocal=withLocalInference,transportMs=0,beforeSettle}={}){
 const enteredAt=performance.now();
 const captured=capture(claim);if(typeof request!=='function'||typeof fetchImpl!=='function'||typeof runLocal!=='function'||!Number.isFinite(transportMs)||transportMs<0)throw invalid();
 await directory(terminalRoot,{create:true});
 const remaining=Math.max(0,captured.deadline-captured.serverNow-transportMs),deadline=enteredAt+remaining,binding=captured.binding;
 let terminalFile,observed,invocationId,engineEntered=false,startRequested=false,startRefused=false,gateSettled=false,settlementReady=false;
 const prepareSettlement=async()=>{if(!settlementReady){settlementReady=true;await beforeSettle?.();}};
 const fail=async reason=>{try{return await request('fail',{...binding,reason});}catch{return null;}};
 if(signal?.aborted){await prepareSettlement();await fail('local-stopped');return{status:'stopped'};}
 if(remaining<=0){await prepareSettlement();try{await request('defer',binding);return{status:'deferred'};}catch{return{status:'stopped'};}}
 try{
  await localChat(endpoint,captured.body,{signal,priority:'cooking',fetchImpl:async(url,options)=>{
   if(url!==endpoint||options.body!==JSON.stringify(captured.body))throw invalid();
   return fetchImpl(url,options);
  },runLocal:async(options,native)=>{
   try{
    const waitMs=Math.floor(deadline-performance.now());if(waitMs<1)throw Object.assign(Error('local_inference_deferred'),{code:'local_inference_deferred'});
    const envelope=await runLocal({...options,waitMs},async()=>{
     if(signal?.aborted||performance.now()>=deadline)throw new LocalInferenceSettledFailure();
     let grant;startRequested=true;
     try{grant=await request('start',binding);}catch(error){startRefused=Number.isInteger(error.status)&&error.status>=400&&error.status<500;throw new LocalInferenceSettledFailure();}
     if(grant?.invocationGranted!==true||!uuid.test(grant.invocationId)||grant.jobId!==binding.jobId||grant.intentHash!==binding.intentHash||grant.bodyHash!==binding.bodyHash)throw new LocalInferenceSettledFailure();
     invocationId=grant.invocationId;
     if(signal?.aborted||performance.now()>=deadline)throw new LocalInferenceSettledFailure();
     engineEntered=true;observed=await native();return observed;
    });gateSettled=true;return envelope;
   }finally{
    // Native observation and gate cleanup are independent. If cleanup fails,
    // keep the returned original as uncertain evidence without freeing the slot.
    if(observed&&invocationId)terminalFile=await keepTerminal(terminalRoot,{schema:1,binding,intent:captured.intent,deadline:captured.deadline,serverNow:captured.serverNow,invocationId,envelope:observed,gateSettled,stopped:!!signal?.aborted});
   }
  }});
 }catch(error){
  await prepareSettlement();
  if(terminalFile)return settleCookingHelp(terminalFile,{request});
  if(!engineEntered&&!startRequested&&error.code==='local_inference_deferred'){
   try{await request('defer',binding);return{status:'deferred'};}catch{return{status:'uncertain'};}
  }
  await fail(engineEntered?'local-uncertain':'local-stopped');
  return{status:engineEntered||startRequested&&!startRefused?'uncertain':'stopped',terminalRetained:false};
 }
 await prepareSettlement();
 return settleCookingHelp(terminalFile,{request});
}
