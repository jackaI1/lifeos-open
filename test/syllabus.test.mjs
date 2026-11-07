import test from 'node:test';import assert from 'node:assert/strict';
import {syllabusPreview} from '../src/local/syllabus.ts';
const events=[{title:'Fictional lab',start:'2026-11-09T10:00:00-05:00',end:'2026-11-09T11:00:00-05:00'}];
test('Claude tool call shares only chosen text and returns reviewable drafts',async()=>{
 let sent;const result=await syllabusPreview({text:'Chosen lab time',provider:'claude',env:{ANTHROPIC_API_KEY:'fake'},request:async(url,init)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');sent=JSON.parse(init.body);return Response.json({content:[{type:'tool_use',name:'draft_calendar_events',input:{events}}]});},local:()=>{throw Error('unexpected fallback');}});
 assert.equal(result.provider,'claude');assert.equal(result.confirmationRequired,true);assert.deepEqual(sent.messages,[{role:'user',content:'Chosen lab time'}]);assert.equal(sent.tool_choice.name,'draft_calendar_events');assert.deepEqual(result.events,events);
});
for(const failure of ['http','timeout','malformed','missing-key'])test(`Claude ${failure} uses local fallback without exposing secrets`,async()=>{
 let called=false;const result=await syllabusPreview({text:'selected',provider:'claude',env:failure==='missing-key'?{}:{ANTHROPIC_API_KEY:'secret'},request:async()=>{if(failure==='timeout')throw new DOMException('secret','TimeoutError');return failure==='http'?new Response('secret',{status:429}):Response.json({content:[{type:'tool_use',name:'draft_calendar_events',input:{events:[{title:'bad'}]}}]});},local:async text=>{called=true;assert.equal(text,'selected');return {events};}});
 assert.ok(called);assert.equal(result.provider,'local');assert.ok(result.fallback);assert.ok(!JSON.stringify(result).includes('secret'));
});
test('local errors stay errors, invalid tool output never becomes a calendar entry',async()=>{
 await assert.rejects(syllabusPreview({text:'a',provider:'local',local:async()=>({events:[{...events[0],end:events[0].start}]})}));
 await assert.rejects(syllabusPreview({text:'a',provider:'local',local:async()=>{throw Error('offline');}}),/offline/);
});
test('settings never store a key; preview cannot write before explicit calendar confirmation',async()=>{
 const {createService}=await import('../src/local/service.ts');const app=await createService({database:':memory:',env:{ANTHROPIC_API_KEY:'fictional-secret'}}),origin=app.origin;
 const call=(path,method='GET',body)=>app.fetch(new Request(origin+path,{method,headers:{origin,'x-lifeos-csrf':app.env.LOCAL_CSRF,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
 const previous=globalThis.fetch;
 try{
  assert.equal((await call('/api/assistant-connection','PUT',{provider:'claude',key:'do-not-store'})).status,400);
  assert.equal((await call('/api/assistant-connection','PUT',{provider:'claude'})).status,200);
  const prefs=await(await call('/api/assistant-connection')).json();assert.equal(prefs.provider,'claude');assert.ok(!JSON.stringify(prefs).includes('fictional-secret'));
  const count=async()=>Number((await app.db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='calendar-event'").first()).n),before=await count();
  globalThis.fetch=async()=>Response.json({content:[{type:'tool_use',name:'draft_calendar_events',input:{events}}]});
  const preview=await(await call('/api/syllabus-preview','POST',{text:'Chosen syllabus text'})).json();assert.equal(preview.provider,'claude');assert.equal(await count(),before);
  const e=preview.events[0],confirmed={id:crypto.randomUUID(),version:0,mutationId:crypto.randomUUID(),title:e.title,start:e.start,end:e.end,location:''};
  assert.equal((await call('/api/actions/local-calendar','POST',confirmed)).status,200);assert.equal(await count(),before+1);
  assert.equal((await call('/api/actions/local-calendar','POST',confirmed)).status,200);assert.equal(await count(),before+1);
  const rows=await app.db.prepare("SELECT * FROM meta WHERE key='syllabus-provider'").all();assert.ok(!JSON.stringify(rows).includes('fictional-secret'));
 }finally{globalThis.fetch=previous;await app.close();}
});
