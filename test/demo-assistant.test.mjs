import test from 'node:test';
import assert from 'node:assert/strict';
import {demoAssistantOptions,demoAssistantAnswer} from '../public/demo-assistant.js';
import {createService} from '../src/local/service.ts';
test('each assistant has distinct ready-to-send examples',()=>{
 const all=['today','academics','finances','lecture','project','support'].flatMap(scope=>{const options=demoAssistantOptions(scope);assert.ok(options.length>=3,scope);return options;});
 assert.equal(new Set(all.map(o=>o.id)).size,all.length);
 for(const o of all){assert.ok(o.message&&o.label);assert.ok(o.message.length<250);}
});
test('planning questions use real free intervals without pretending to edit',()=>{
 const slot={start:'2026-10-23T16:00:00Z',end:'2026-10-23T17:00:00Z',type:'academic'},context={timeZone:'America/Toronto',freeSlots:[slot],schedule:[]};
 const option=demoAssistantOptions('today').find(o=>o.id==='today-fit'),r=demoAssistantAnswer('today',option.message,context);
 assert.match(r.reply,/12:00/);assert.deepEqual(r.proposals,[]);
 const add=demoAssistantAnswer('today',demoAssistantOptions('today').find(o=>o.id==='today-add').message,context);
 assert.equal(add.proposals[0].operation,'calendar-create');assert.match(add.reply,/Apply change/);
 assert.equal(demoAssistantAnswer('today','A different question',context),null);
});
test('demo schedule examples produce reviewable local changes and preserve the source calendar',async()=>{
 const app=await createService({database:':memory:',origin:'http://127.0.0.1:18751'});
 try{const session=await(await app.fetch(new Request(app.origin+'/api/session'))).json();const api=async(path,method='GET',body)=>{const r=await app.fetch(new Request(app.origin+path,{method,headers:{origin:app.origin,'x-lifeos-csrf':session.csrf,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));assert.equal(r.status,200,await r.clone().text());return r.json();};
 const id=crypto.randomUUID();await api('/api/assistant/threads','POST',{id,scope:'today',mutationId:crypto.randomUUID()});
 await api('/api/assistant/threads/'+id+'/messages','POST',{message:demoAssistantOptions('today').find(o=>o.id==='today-move').message,sentAt:new Date().toISOString(),mutationId:crypto.randomUUID()});
 const moved=await api('/api/assistant/threads/'+id);assert.equal(moved.proposals[0].data.proposal.operation,'schedule-adjust');
 const source=await app.db.prepare("SELECT * FROM records WHERE kind='calendar-event' ORDER BY id").all();
 await api('/api/assistant/threads/'+id+'/messages','POST',{message:demoAssistantOptions('today').find(o=>o.id==='today-add').message,sentAt:new Date().toISOString(),mutationId:crypto.randomUUID()});
 const answer=await api('/api/assistant/threads/'+id);assert.ok(answer.messages.some(m=>m.data.role==='assistant'));assert.equal(answer.proposals.length,2);
 assert.deepEqual((await app.db.prepare("SELECT * FROM records WHERE kind='calendar-event' ORDER BY id").all()).results,source.results,'Sending creates a preview, not an edit');
 const p=answer.proposals.find(p=>p.data.proposal.operation==='calendar-create');await api('/api/assistant/proposals/'+p.id+'/apply','POST',{version:p.version,mutationId:crypto.randomUUID()});
 assert.ok((await app.db.prepare("SELECT data FROM records WHERE kind='calendar-event'").all()).results.some(r=>JSON.parse(r.data).title==='Walk'||JSON.parse(r.data).summary==='Walk'));
 }finally{app.close();}
});
test('moving a study block uses its current revision, and a tomorrow question skips today',()=>{
 const context={asOf:'2026-10-22T14:00:00Z',lifeosDay:'2026-10-22',timeZone:'America/Toronto',schedule:[{day:'2026-10-23',entries:[{id:'study-1',title:'Study feedback',start:'2026-10-23T16:00:00Z',end:'2026-10-23T16:20:00Z',correctionVersion:3}]}],freeSlots:[{day:'2026-10-22',start:'2026-10-22T17:00:00Z',end:'2026-10-22T18:00:00Z'},{day:'2026-10-23',start:'2026-10-23T16:00:00Z',end:'2026-10-23T18:00:00Z'}]};
 const move=demoAssistantAnswer('today',demoAssistantOptions('today')[0].message,context);assert.equal(move.proposals[0].expectedVersion,3);assert.equal(move.proposals[0].fields.find(f=>f.name==='start').value,'2026-10-23T16:30:00.000Z');
 const fit=demoAssistantAnswer('today',demoAssistantOptions('today').find(o=>o.id==='today-fit').message,context);assert.match(fit.reply,/Oct 23/);assert.deepEqual(fit.proposals,[]);
});
test('academic, finance and lecture examples return answers through their existing conversations',async()=>{
 const app=await createService({database:':memory:',origin:'http://127.0.0.1:18752'});
 try{const session=await(await app.fetch(new Request(app.origin+'/api/session'))).json();const api=async(path,method='GET',body)=>{const r=await app.fetch(new Request(app.origin+path,{method,headers:{origin:app.origin,'x-lifeos-csrf':session.csrf,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));assert.equal(r.status,200,await r.clone().text());return r.json();};
 const lecture=(await api('/api/lectures?course=demo-course-design')).items[0];
 for(const scope of ['academics','finances','lecture']){const id=crypto.randomUUID();await api('/api/assistant/threads','POST',{id,scope,...(scope==='lecture'?{lectureId:lecture.id}:{}),mutationId:crypto.randomUUID()});
  for(const o of demoAssistantOptions(scope))await api('/api/assistant/threads/'+id+'/messages','POST',{message:o.message,sentAt:new Date().toISOString(),mutationId:crypto.randomUUID()});
  const data=await api('/api/assistant/threads/'+id);const replies=data.messages.filter(m=>m.data.role==='assistant');assert.equal(replies.length,3);assert.equal(new Set(replies.map(m=>m.data.text)).size,3);assert.deepEqual(data.proposals,[]);
 }
 }finally{app.close();}
});
test('available demo windows exclude corrected commitments',async()=>{
 const {demoAvailableSlots}=await import('../src/local/services.ts');
 const slots=demoAvailableSlots([{date:'2026-10-23',availability:{academicBlocks:[{start:'2026-10-23T16:00Z',end:'2026-10-23T18:00Z'}],discretionaryBlocks:[]},timeline:[{kind:'dinner',corrected:true,start:'2026-10-23T16:30Z',end:'2026-10-23T17:30Z'}]}],'2026-10-22T14:00Z');
 assert.equal(slots.length,2);assert.ok(slots.every(s=>Date.parse(s.end)<=Date.parse('2026-10-23T16:30Z')||Date.parse(s.start)>=Date.parse('2026-10-23T17:30Z')));
});
test('example choices wait for draft recovery and never overwrite an unsent draft',async()=>{
 const {demoAssistantChoices}=await import('../public/demo-assistant-choices.js');
 class Node{constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.dataset={};}setAttribute(){}addEventListener(k,v){this.listeners[k]=v;}append(v){this.children.push(v);}}
 const oldDocument=globalThis.document,oldNode=globalThis.Node;globalThis.Node=Node;globalThis.document={createElement:t=>new Node(t),createTextNode:t=>({textContent:t})};
 try{let ready=false,sent=0,release;const input={value:'',dispatchEvent(){}},node=demoAssistantChoices({session:{mode:'demo',services:{ai:'mock'}},scope:'today',input,canSend:()=>ready,onSend:()=>{sent++;return new Promise(ok=>{release=ok;});}}),choice=node.children[1].children[0];
  assert.equal(choice.disabled,true);await choice.listeners.click();assert.equal(sent,0);assert.equal(input.value,'');
  ready=true;input.value='Recovered writing';node.refresh();await choice.listeners.click();assert.equal(input.value,'Recovered writing');assert.equal(sent,0);
  input.value='';const pending=choice.listeners.click();await choice.listeners.click();assert.equal(sent,1);assert.equal(choice.disabled,true);release();await pending;
  assert.equal(demoAssistantChoices({session:{mode:'local',services:{ai:'mock'}},scope:'today',input,onSend(){}}),null);
 }finally{globalThis.document=oldDocument;globalThis.Node=oldNode;}
});
test('demo dining answer agrees with reconciled Finances balances',async()=>{
 const app=await createService({database:':memory:',origin:'http://127.0.0.1:18753'});
 try{const session=await(await app.fetch(new Request(app.origin+'/api/session'))).json();const api=async(path,method='GET',body)=>{const r=await app.fetch(new Request(app.origin+path,{method,headers:{origin:app.origin,'x-lifeos-csrf':session.csrf,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));assert.equal(r.status,200,await r.clone().text());return r.json();};
 await api('/api/finances/reconcile','POST',{transactionId:'demo-lunch',transactionVersion:1,version:0,decision:'transfer',mutationId:crypto.randomUUID()});
 const finances=await api('/api/finances'),id=crypto.randomUUID();await api('/api/assistant/threads','POST',{id,scope:'finances',mutationId:crypto.randomUUID()});await api('/api/assistant/threads/'+id+'/messages','POST',{message:demoAssistantOptions('finances')[0].message,sentAt:new Date().toISOString(),mutationId:crypto.randomUUID()});
 const data=await api('/api/assistant/threads/'+id),remaining=finances.summary.cards.find(c=>c.id==='dining').remaining/100;assert.ok(data.messages.find(m=>m.data.role==='assistant').data.text.includes(new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(remaining)));
 }finally{app.close();}
});

test('project examples explain different useful starting actions',()=>{
 const replies=demoAssistantOptions('project').map(o=>demoAssistantAnswer('project',o.message,{project:{title:'Example project',nextStep:'Sketch the first screen'}}).reply);
 assert.equal(new Set(replies).size,3);assert.ok(replies.every(r=>r.includes('Example project')));
});

test('project examples have a useful first step when portfolio notes are empty',()=>{
 const reply=demoAssistantAnswer('project',demoAssistantOptions('project')[0].message,{project:{title:'LifeOS Open',nextStep:''}}).reply;
 assert.match(reply,/define one small result/);assert.doesNotMatch(reply,/, \./);
});

test('an authored example preserves a photo-only draft and ignores a completed native double-click',async()=>{
 const {demoAssistantChoices}=await import('../public/demo-assistant-choices.js');
 class Node{constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.dataset={};}setAttribute(){}addEventListener(k,v){this.listeners[k]=v;}append(v){this.children.push(v);}querySelector(){return this.children[0];}}
 const oldDocument=globalThis.document,oldNode=globalThis.Node;globalThis.Node=Node;globalThis.document={createElement:t=>new Node(t),createTextNode:t=>({textContent:t})};
 try{const photoDraft={attachments:['retained-photo']},original=structuredClone(photoDraft);let attachments=photoDraft.attachments,sent=0,preserved=0;const input={value:'',dispatchEvent(){}};
 const node=demoAssistantChoices({session:{mode:'demo',services:{ai:'mock'}},scope:'today',input,hasDraft:()=>!!input.value.trim()||attachments.length>0,onDraft:async()=>{preserved++;attachments=[];return true;},onSend:async()=>{assert.deepEqual(attachments,[]);sent++;input.value='';}}),choice=node.children[1].children[0];
 await choice.listeners.click({detail:1});assert.equal(sent,1);assert.equal(preserved,1);assert.deepEqual(photoDraft,original);
 await choice.listeners.click({detail:2});assert.equal(sent,1);assert.equal(input.value,'');
 }finally{globalThis.document=oldDocument;globalThis.Node=oldNode;}
});
