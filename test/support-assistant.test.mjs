import test from 'node:test';
import assert from 'node:assert/strict';
import {SupportAssistant,classifyTicket,loadSops} from '../src/support/assistant.mjs';
import {RetrievalIndex} from '../src/local/retrieval.mjs';

const embed=async texts=>texts.map(text=>/retrieval|embedding|rag/i.test(text)?[1,0,0,0]:/backup|upgrade/i.test(text)?[0,1,0,0]:/transcript|whisper|recording/i.test(text)?[0,0,1,0]:[0,0,0,1]);
async function fixture(run){
 const index=new RetrievalIndex(':memory:',{embed,modelId:'synthetic-support'});
 try{await index.sync(await loadSops());await run(new SupportAssistant({index}),index);}finally{index.close();}
}
test('local tool router searches approved SOPs and cites an actual source without a provider',async()=>{
 await fixture(async assistant=>{
  const result=await assistant.ask('My retrieval embedding is unavailable');
  assert.equal(result.category,'retrieval');assert.equal(result.status,'suggested');assert.deepEqual(result.trace,['inspect_runtime','search_sops']);
  assert.ok(result.citations.every(c=>c.sourceKey==='sop/retrieval'));assert.match(result.text,/rag:download/);assert.match(result.text,/\[1\]/);
 });
});
test('unknown, ambiguous and high impact tickets escalate without executing tools',async()=>{
 await fixture(async assistant=>{
  for(const ticket of ['The satellite is broken','My backup and retrieval are broken','My backup has missing files']){
   const result=await assistant.ask(ticket);assert.equal(result.status,'escalated');assert.deepEqual(result.trace,[]);assert.deepEqual(result.citations,[]);
  }
  assert.equal(classifyTicket('My backup has missing files').priority,'high');
  for(const ticket of ['',null,'x'.repeat(4001)])assert.throws(()=>classifyTicket(ticket));
 });
});
test('empty evidence and tool failure escalate instead of proposing a fix',async()=>{
 for(const index of [{search:async()=>[]},{search:async()=>{throw Error('unavailable');}}]){
  const result=await new SupportAssistant({index}).ask('My retrieval is unavailable');assert.equal(result.status,'escalated');assert.deepEqual(result.citations,[]);
 }
});
test('Azure agent chooses real LangChain tools and validated evidence controls its final answer',async()=>{
 await fixture(async(_,index)=>{
  const original=globalThis.fetch;let round=0;
  globalThis.fetch=async(url,init)=>{
   assert.match(String(url),/openai\/deployments\/support/);assert.equal(init.headers['api-key'],'synthetic');
   const body=JSON.parse(init.body);round++;
   if(round===1){
    assert.equal(body.tools.length,2);assert.match(body.messages[0].content,/read-only/);
    return Response.json({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'a',type:'function',function:{name:'inspect_runtime',arguments:'{}'}},{id:'b',type:'function',function:{name:'search_sops',arguments:JSON.stringify({query:'retrieval embedding unavailable'})}}]}}]});
   }
   const evidence=JSON.parse(body.messages.find(m=>m.tool_call_id==='b').content)[0];
   assert.equal(evidence.sourceKey,'sop/retrieval');
   return Response.json({choices:[{message:{content:JSON.stringify({claims:[{text:'Check the local embedding setup.',source:evidence.id,quote:evidence.text}]})}}]});
  };
  try{
   const assistant=new SupportAssistant({index,env:{LLM_MODE:'real',LLM_PROVIDER:'azure',LLM_BASE_URL:'https://synthetic.openai.azure.com',LLM_MODEL:'support',LLM_API_KEY:'synthetic'}});
   const result=await assistant.ask('My retrieval embedding is unavailable');assert.equal(round,2);assert.equal(result.status,'suggested');assert.match(result.text,/Check the local embedding setup/);assert.equal(result.citations[0].sourceKey,'sop/retrieval');
  }finally{globalThis.fetch=original;}
 });
});
test('model bypasses, invented citations, invalid tool arguments and repeated tool calls fail closed',async()=>{
 await fixture(async(_,index)=>{
  const original=globalThis.fetch;const env={LLM_MODE:'real',LLM_PROVIDER:'azure',LLM_BASE_URL:'https://synthetic.openai.azure.com',LLM_MODEL:'support',LLM_API_KEY:'synthetic'};
  try{
   for(const message of [
    {content:'{"claims":[{"text":"delete everything","source":"invented","quote":"fake"}]}'},
    {tool_calls:[{id:'bad',type:'function',function:{name:'delete_files',arguments:'{}'}}]},
    {tool_calls:[{id:'bad',type:'function',function:{name:'search_sops',arguments:'{"query":2}'}}]},
    {tool_calls:[{id:'loop',type:'function',function:{name:'inspect_runtime',arguments:'{}'}}]},
   ]){
    let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message}]});};
    const result=await new SupportAssistant({index,env}).ask('My retrieval is unavailable');assert.equal(result.status,'escalated');assert.deepEqual(result.citations,[]);assert.ok(calls<=6);
   }
  }finally{globalThis.fetch=original;}
 });
});
