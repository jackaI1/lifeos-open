import {withLocalInference,LocalInferenceSettledFailure} from './local-inference-gate.mjs';
const MODEL='qwen3.8:27b-q4_K_M';
const invalid=()=>Object.assign(Error('local_request_invalid'),{code:'local_request_invalid'});
function captureRequest(request){
 try{
  const serialized=JSON.stringify(request);
  if(typeof serialized!=='string'||Buffer.byteLength(serialized)>8_388_608)throw invalid();
  const value=JSON.parse(serialized);
  if(!value||Array.isArray(value)||value.model!==MODEL||value.stream!==false||value.think!==false)throw invalid();
  const options=value.options??{};
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['num_ctx','num_predict','temperature'].includes(key)))throw invalid();
  const num_ctx=options.num_ctx??8192,num_predict=options.num_predict??2048,temperature=options.temperature??0.1;
  if(!Number.isInteger(num_ctx)||num_ctx<1||num_ctx>8192||!Number.isInteger(num_predict)||num_predict<1||num_predict>4096||!Number.isFinite(temperature)||temperature<0||temperature>2)throw invalid();
  const keep_alive=value.keep_alive??'30s';
  if(![0,'0s','30s','2m'].includes(keep_alive))throw invalid();
  const body=JSON.stringify({...value,options:{num_ctx,num_predict,temperature},keep_alive});
  if(Buffer.byteLength(body)>8_388_608)throw invalid();
  return body;
 }catch{throw invalid();}
}
/** One bounded native request. Never log request, envelope, errors or model text. */
export async function localChat(url,request,{fetchImpl=fetch,runLocal=withLocalInference,signal,priority='private'}={}){
 let target;
 try{target=new URL(url);}catch{throw invalid();}
 if(target.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(target.hostname)||target.port!=='11434'||target.pathname!=='/api/chat'||target.search||target.hash||target.username||target.password)throw invalid();
 // Capture and validate the actual serialized payload before waiting. Callers
 // cannot mutate queued input, and deterministic errors never occupy a slot.
 const body=captureRequest(request),endpoint=target.href;
 const envelope=await runLocal({priority,signal},async()=>{
  const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(360000),headers:{'Content-Type':'application/json'},body});
  const reader=response.body?.getReader();if(!reader)throw Error('Native completion unavailable');
  const chunks=[];let bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2_097_152)throw Error('Native response limit exceeded');chunks.push(part.value);}}
  finally{reader.releaseLock();}
  if(!response.ok)throw new LocalInferenceSettledFailure('local_http_rejected');
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Native completion unavailable');}
  if(value?.done!==true)throw Error('Native completion unavailable');
  if(value.model!==MODEL||value.done_reason==='length'||value.message?.thinking)throw new LocalInferenceSettledFailure('local_model_rejected');
  return value;
 });
 // Cancellation does not interrupt an already-running native engine. Drain it,
 // release the observed slot, then prevent callers applying its discarded result.
 if(signal?.aborted)throw Object.assign(Error('local_inference_aborted'),{code:'local_inference_aborted'});
 return envelope;
}
