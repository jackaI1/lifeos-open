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
