import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../src/local/service.ts';
import {demoAssistantOptions} from '../public/demo-assistant.js';
test('one-click demo change applies only its own validated proposal and does not repeat it',async()=>{
 const module=await import('../public/demo-assistant-actions.js').catch(()=>({}));assert.equal(typeof module.applyDemoExampleChanges,'function');
 const app=await createService({database:':memory:',origin:'http://127.0.0.1:18753'});
 try{const session=await(await app.fetch(new Request(app.origin+'/api/session'))).json();const request=async(path,options={})=>{const r=await app.fetch(new Request(app.origin+path,{method:options.method??'GET',headers:{origin:app.origin,'x-lifeos-csrf':session.csrf,'content-type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{})}));assert.equal(r.status,200,await r.clone().text());return r.json();};const threadId=crypto.randomUUID();await request('/api/assistant/threads',{method:'POST',body:{id:threadId,scope:'today',mutationId:crypto.randomUUID()}});
 const send=example=>request('/api/assistant/threads/'+threadId+'/messages',{method:'POST',body:{message:example.message,sentAt:new Date().toISOString(),mutationId:crypto.randomUUID()}});
 const [move,add]=demoAssistantOptions('today');await send(move);const result=await send(add);const call={session,example:add,threadId,jobId:result.job.id,request};
 assert.equal(await module.applyDemoExampleChanges(call),1);const after=await request('/api/assistant/threads/'+threadId);assert.equal(after.proposals.find(p=>p.data.proposal.operation==='calendar-create').data.status,'applied');assert.ok(after.proposals.filter(p=>p.data.proposal.operation==='schedule-adjust').every(p=>p.data.status==='proposed'));assert.equal(await module.applyDemoExampleChanges(call),0);
 const personal={...call,session:{mode:'owner',services:{ai:'real'}},request:()=>{throw Error('Must not read or change a personal workspace');}};assert.equal(await module.applyDemoExampleChanges(personal),0);
 }finally{app.close();}
});
test('applied demo reply reports its current state without changing the retained message',async()=>{
 const module=await import('../public/demo-assistant-actions.js').catch(()=>({}));assert.equal(typeof module.demoAssistantDisplayText,'function');const message={mock:true,text:'Nothing has been added yet.',proposalIds:['p']},original=structuredClone(message),proposal={id:'p',data:{status:'applied',targetTitle:'Walk',proposal:{operation:'calendar-create'}}};assert.match(module.demoAssistantDisplayText(message,[proposal]),/added.*local demo schedule/i);assert.deepEqual(message,original);assert.equal(module.demoAssistantDisplayText({...message,mock:false},[proposal]),message.text);proposal.data.status='undone';assert.match(module.demoAssistantDisplayText(message,[proposal]),/undone/);
});
