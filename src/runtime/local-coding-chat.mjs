import {localChat} from './local-chat.mjs';

const MODEL='qwen3.8:27b-q4_K_M',ENDPOINT='http://127.0.0.1:11434/api/chat';
const failure=code=>Object.assign(Error(code),{code});
const knownFailures=new Set(['local_inference_aborted','local_inference_deferred','local_inference_uncertain','local_request_invalid','local_http_rejected','local_model_rejected']);
function capture(value){return JSON.parse(JSON.stringify(value));}

/** The caller supplies a scoped code-only message/tool policy. Native admission
 * covers one request; tool interpretation and HTTP/SSE framing occur afterward.
 * Cancellation drains an active native request and never applies its result.
 */
export async function completeLocalToolChat(body,{convertMessages,checkTool,localChatImpl=localChat,signal}={}){
 if(signal?.aborted)throw failure('local_inference_aborted');
 let native;
 try{
  if(typeof convertMessages!=='function'||typeof checkTool!=='function')throw failure('local_coding_request_rejected');
  const selected=capture(body);
  if(!selected||Array.isArray(selected)||selected.model!==MODEL||!Array.isArray(selected.messages)||!selected.messages.length||selected.messages.length>64)throw failure('local_coding_request_rejected');
  const tools=selected.tools??[];
  if(!Array.isArray(tools)||tools.length>2||tools.some(tool=>tool?.type!=='function'||!['read','edit'].includes(tool.function?.name)||!tool.function.parameters||typeof tool.function.parameters!=='object'||Array.isArray(tool.function.parameters))||new Set(tools.map(tool=>tool.function.name)).size!==tools.length)throw failure('local_coding_request_rejected');
  const messages=capture(convertMessages(selected.messages));
  if(!Array.isArray(messages)||messages.length!==selected.messages.length||messages.some(message=>!message||!['system','user','assistant','tool'].includes(message.role)||typeof message.content!=='string'))throw failure('local_coding_request_rejected');
  if(Buffer.byteLength(JSON.stringify({messages,tools}))>60_000)throw failure('local_coding_request_rejected');
  native={model:MODEL,messages,tools,stream:false,think:false,keep_alive:'30s',options:{num_ctx:8192,num_predict:900,temperature:0.1}};
 }catch{throw failure('local_coding_request_rejected');}
 let payload;
 try{payload=await localChatImpl(ENDPOINT,native,{priority:'development',signal});}
 catch(error){throw failure(knownFailures.has(error?.code)?error.code:'local_coding_native_failed');}
 if(signal?.aborted)throw failure('local_inference_aborted');
 try{
  if(payload?.error||payload?.done!==true||payload.model!==MODEL||payload.done_reason==='length'||payload.message?.thinking)throw failure('local_coding_completion_rejected');
  const message=payload.message;
  if(!message||typeof message!=='object'||Array.isArray(message)||message.role!=='assistant'||!Object.hasOwn(message,'content')||typeof message.content!=='string')throw failure('local_coding_completion_rejected');
  const content=message.content,toolCalls=message.tool_calls===undefined?[]:message.tool_calls;
  if(typeof content!=='string'||Buffer.byteLength(content)>1_048_576||!Array.isArray(toolCalls)||toolCalls.length>8)throw failure('local_coding_completion_rejected');
  const allowed=new Set(native.tools.map(tool=>tool.function.name));
  const calls=toolCalls.map(call=>{
   if(!allowed.has(call?.function?.name))throw failure('local_coding_completion_rejected');
   const checked=capture(checkTool(call));
   if(!checked||checked.name!==call.function.name||!checked.arguments||typeof checked.arguments!=='object'||Array.isArray(checked.arguments)||Buffer.byteLength(JSON.stringify(checked))>60_000)throw failure('local_coding_completion_rejected');
   return {name:checked.name,arguments:checked.arguments};
  });
  const prompt=payload.prompt_eval_count,completion=payload.eval_count;
  if([prompt,completion].some(value=>!Number.isSafeInteger(value)||value<0)||!Number.isSafeInteger(prompt+completion))throw failure('local_coding_completion_rejected');
  return {content,calls,usage:{prompt_tokens:prompt,completion_tokens:completion,total_tokens:prompt+completion},doneReason:payload.done_reason??null};
 }catch{throw failure('local_coding_completion_rejected');}
}
