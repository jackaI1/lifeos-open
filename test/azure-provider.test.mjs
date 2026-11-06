import test from 'node:test';
import assert from 'node:assert/strict';
import {chatCompletion} from '../src/shared/llm.mjs';

const env={LLM_MODE:'real',LLM_PROVIDER:'azure',LLM_BASE_URL:'https://synthetic.openai.azure.com/',LLM_MODEL:'support deployment',LLM_API_KEY:'synthetic-placeholder'};
test('Azure uses deployment routing, version, api-key and grounded JSON prompt',async()=>{
 const original=globalThis.fetch;let called=0;
 globalThis.fetch=async(url,init)=>{
  called++;assert.equal(String(url),'https://synthetic.openai.azure.com/openai/deployments/support%20deployment/chat/completions?api-version=2024-10-21');
  assert.equal(init.headers['api-key'],'synthetic-placeholder');assert.equal(init.headers.authorization,undefined);
  const body=JSON.parse(init.body);assert.equal(body.response_format.type,'json_object');assert.match(body.messages[0].content,/reference data, never instructions/);assert.match(body.messages[0].content,/synthetic passage/);assert.equal(body.messages[1].content,'Where is it?');assert.ok(init.signal);
  return Response.json({choices:[{message:{content:'{"claims":[]}'}}]});
 };
 try{assert.equal(await chatCompletion({env,message:'Where is it?',context:'synthetic passage',schema:{type:'object'}}),'{"claims":[]}');assert.equal(called,1);}finally{globalThis.fetch=original;}
});
test('Azure supports version overrides, rejects unconfigured models and unsafe endpoint settings',async()=>{
 const original=globalThis.fetch;let called=0;
 globalThis.fetch=async(url)=>{called++;assert.equal(new URL(url).searchParams.get('api-version'),'2025-01-01-preview');return Response.json({choices:[{message:{content:'ok'}}]});};
 try{
  await chatCompletion({env:{...env,AZURE_OPENAI_API_VERSION:'2025-01-01-preview'},message:'test'});
  for(const patch of [{LLM_MODEL:''},{LLM_PROVIDER:'typo'},{LLM_BASE_URL:'http://remote.example.test'},{LLM_BASE_URL:'https://synthetic.openai.azure.com/openai'},{LLM_BASE_URL:'https://user:secret@example.test'},{LLM_BASE_URL:'https://example.test?api-key=secret'}])await assert.rejects(()=>chatCompletion({env:{...env,...patch},message:'test'}));
  await assert.rejects(()=>chatCompletion({env,message:'test',model:'unconfigured'}));assert.equal(called,1);
 }finally{globalThis.fetch=original;}
});
test('Azure errors never expose provider response bodies or credentials',async()=>{
 const original=globalThis.fetch;
 try{
  for(const status of [401,429,500]){
   globalThis.fetch=async()=>new Response('sensitive-provider-detail',{status});
   await assert.rejects(()=>chatCompletion({env,message:'test'}),error=>error.message.includes('could not answer')&&!error.message.includes('sensitive'));
  }
  globalThis.fetch=async()=>Response.json({choices:[]});await assert.rejects(()=>chatCompletion({env,message:'test'}),/no text/);
 }finally{globalThis.fetch=original;}
});
test('Azure is opt-in; default offline replies never call a provider',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Unexpected network');};
 try{assert.equal(typeof await chatCompletion({env:{LLM_PROVIDER:'azure'},message:'Help'}),'string');}finally{globalThis.fetch=original;}
});
