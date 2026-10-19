import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {completeLocalToolChat} from './local-coding-chat.mjs';

const MODEL='qwen3.8:27b-q4_K_M';
const fail=code=>Object.assign(Error(code),{code});
const publicFailures=new Set(['local_coding_request_rejected','local_coding_completion_rejected','local_coding_native_failed','local_inference_aborted','local_inference_deferred','local_inference_uncertain','local_request_invalid','local_http_rejected','local_model_rejected']);

/** Ephemeral loopback proxy. Its per-run credential must be handed only to the
 * local coding process. Never log it, prompts, completions or tool arguments.
 * The caller owns the code-only tool policy and OS containment.
 */
export function createLocalCodingGateway({convertMessages,checkTool,maxRequests=4,completeImpl=completeLocalToolChat}={}){
 if(typeof convertMessages!=='function'||typeof checkTool!=='function'||typeof completeImpl!=='function'||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>32)throw fail('local_coding_gateway_config_rejected');
 const token=randomBytes(32).toString('hex'),expected=Buffer.from('Bearer '+token);
 const active=new Set();let requests=0,applied=0,rejected=0,closed=false,started=false,closing,listenReady;
 const metadata=()=>({requests,applied,rejected,active:active.size,maxRequests,closed,model:MODEL,provider:'loopback_ollama'});
 const reply=(response,status,value)=>{if(!response.destroyed){response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));}};
 const errorReply=(response,status,code)=>reply(response,status,{error:{message:code,type:'local_policy'}});
 const server=createServer(async(request,response)=>{
  const authorization=Buffer.from(typeof request.headers.authorization==='string'?request.headers.authorization:'');
  if(authorization.length!==expected.length||!timingSafeEqual(authorization,expected))return errorReply(response,401,'local_coding_authorization_required');
  if(closed)return errorReply(response,503,'local_coding_gateway_closed');
  if(request.method!=='POST'||request.url!=='/v1/chat/completions')return errorReply(response,404,'local_coding_route_rejected');
  const controller=new AbortController();let finish;const settled=new Promise(resolve=>finish=resolve);const entry={controller,settled};active.add(entry);
  const onClose=()=>controller.abort();response.once('close',onClose);request.once('aborted',onClose);
  try{
   const chunks=[];let bytes=0;
   for await(const chunk of request){bytes+=chunk.length;if(bytes>180_000)throw fail('local_coding_request_too_large');chunks.push(chunk);}
   if(controller.signal.aborted||closed)throw fail('local_inference_aborted');
   let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw fail('local_coding_request_rejected');}
   if(requests>=maxRequests)throw fail('local_coding_request_limit');requests++;
   const result=await completeImpl(body,{convertMessages,checkTool,signal:controller.signal});
   if(controller.signal.aborted||closed||response.destroyed)throw fail('local_inference_aborted');
   const id='local-coding-'+requests+'-'+randomBytes(8).toString('hex'),created=Math.floor(Date.now()/1000),calls=result.calls.map((call,index)=>({id:id+'-'+index,type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}));
   const finishReason=calls.length?'tool_calls':'stop';
   if(body.stream===true){
    response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});
    const emit=(delta,finish_reason=null,usage)=>response.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',created,model:MODEL,choices:[{index:0,delta,finish_reason}],...(usage?{usage}:{})})+'\n\n');
    emit({role:'assistant'});if(result.content)emit({content:result.content});calls.forEach((call,index)=>emit({tool_calls:[{index,...call}]}));emit({},finishReason,result.usage);response.end('data: [DONE]\n\n');
   }else reply(response,200,{id,object:'chat.completion',created,model:MODEL,choices:[{index:0,message:{role:'assistant',content:result.content,...(calls.length?{tool_calls:calls}:{})},finish_reason:finishReason}],usage:result.usage});
   applied++;
  }catch(error){
   rejected++;
   const code=error?.code==='local_coding_request_too_large'||error?.code==='local_coding_request_limit'?error.code:publicFailures.has(error?.code)?error.code:'local_coding_native_failed';
   const status=code==='local_coding_request_too_large'?413:code==='local_coding_request_limit'?429:code==='local_coding_request_rejected'?400:503;
   errorReply(response,status,code);
  }finally{response.removeListener('close',onClose);request.removeListener('aborted',onClose);active.delete(entry);finish();}
 });
 server.requestTimeout=10_000;server.headersTimeout=10_000;server.maxRequestsPerSocket=32;
 return {
  metadata,
  async listen(){
   if(started||closed)throw fail('local_coding_gateway_state_rejected');started=true;
   listenReady=new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
   try{await listenReady;}
   catch{closed=true;throw fail('local_coding_gateway_start_failed');}
   if(closed)throw fail('local_coding_gateway_state_rejected');
   return {baseURL:'http://127.0.0.1:'+server.address().port+'/v1',token};
  },
  close(){
   if(closing)return closing;closed=true;for(const entry of active)entry.controller.abort();
   const drains=[...active].map(entry=>entry.settled);
   closing=(async()=>{if(listenReady)await listenReady.catch(()=>{});const stopped=server.listening?new Promise(resolve=>server.close(resolve)):Promise.resolve();server.closeAllConnections();await Promise.all([...drains,stopped]);})();return closing;
  }
 };
}
