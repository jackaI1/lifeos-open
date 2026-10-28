import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../src/local/service.ts';
import {importCalendarSnapshot,currentTermWindow} from '../src/integrations/jobs.mjs';
import {buildCoopProfile,buildCoopDraftPrompt} from '../src/integrations/coop.mjs';
import {createHash} from 'node:crypto';
async function fixture(fn){const app=await createService({database:':memory:',demo:false});try{const session=await(await app.fetch(new Request(app.origin+'/api/session'))).json();const api=async(path,data,method='POST')=>{const r=await app.fetch(new Request(app.origin+path,{method:data?method:'GET',headers:{origin:app.origin,'x-lifeos-csrf':session.csrf,'content-type':'application/json'},body:data?JSON.stringify(data):undefined}));return {status:r.status,data:await r.json()};};await fn({app,api});}finally{app.close();}}
test('manual academic records save with revision and course guards',()=>fixture(async({api,app})=>{
 const course=await api('/api/records/course/manual-course',{version:0,mutationId:crypto.randomUUID(),data:{title:'Example course',code:'DEMO',term:'Example term'}},'PUT');assert.equal(course.status,200);
 const body={version:0,mutationId:crypto.randomUUID(),data:{title:'Read instructions',courseId:'manual-course',remainingMinutes:25,status:'todo'}};
 assert.equal((await api('/api/records/task/manual-task',body,'PUT')).status,200);assert.equal((await api('/api/records/task/manual-task',body,'PUT')).status,200);
 assert.equal((await api('/api/records/task/manual-task',{...body,mutationId:crypto.randomUUID()},'PUT')).status,409);
 assert.equal((await api('/api/records/task/missing-course',{...body,mutationId:crypto.randomUUID(),data:{...body.data,courseId:'missing'}},'PUT')).status,400);
 assert.equal((await api('/api/bootstrap')).data.records.task[0].data.title,'Read instructions');assert.equal((await app.db.prepare('SELECT count(*) n FROM jobs').first()).n,0);
}));
test('plain devotional and friends saves need no processing job',()=>fixture(async({api,app})=>{
 const entry={version:0,mutationId:crypto.randomUUID(),date:'2026-10-01',type:'custom',customText:'Synthetic reflection',points:Array(7).fill(''),complete:false};
 assert.equal((await api('/api/devotionals/manual-entry',entry,'PUT')).status,200);assert.equal((await api('/api/devotionals')).data.entries[0].customText,'Synthetic reflection');
 assert.equal((await api('/api/private-friends/example-friend',{version:0,mutationId:crypto.randomUUID(),data:{name:'Example person',text:'Synthetic note',schedule:{frequency:'none'}}},'PUT')).status,200);
 assert.equal((await api('/api/private-friends/example-friend')).data.item.data.text,'Synthetic note');assert.equal((await app.db.prepare('SELECT count(*) n FROM jobs').first()).n,0);
}));
test('generic calendar import accepts an explicitly configured selection',()=>{
 assert.throws(()=>currentTermWindow({window:{startDate:'2026-02-31',endDate:'2026-04-01'}}),/bounded calendar window/);
 const saved=new Map(),store={transaction:fn=>fn(),get:(kind,id)=>saved.get(kind+id),put:(kind,id,data)=>saved.set(kind+id,{kind,id,data}),list:kind=>[...saved.values()].filter(r=>r.kind===kind)};
 const result=importCalendarSnapshot({store,config:{calendarIds:{selected:'example-calendar'}},calendars:[{calendarId:'example-calendar',complete:true,accessRole:'reader',events:[{id:'example-event',summary:'Synthetic event',start:{date:'2026-10-01'}}]}],window:{timeMin:'2026-10-01T00:00:00Z',timeMax:'2026-11-01T00:00:00Z'}});assert.equal(result.calendars,1);assert.equal(result.events,1);
});
test('resume adapter uses supplied evidence and configurable preferences',()=>{
 const bytes=Buffer.from('%PDF-synthetic'),resume={file:{id:'example-resume',mimeType:'application/pdf',name:'Example resume'},bytes},pages=[{page:1,text:'Designed an example community garden with volunteers.'}];
 const profile=buildCoopProfile({resume,pages,workTermEvidence:{workTerm:{year:2027,term:'Spring',sourceUrl:'https://example.test/term',locator:'Selected term'},retrievedAt:'2026-10-01T00:00:00Z'},preferences:{interests:[],locationPreferences:[],excludedIndustries:[]}});
 assert.equal(profile.resume.textSha256,createHash('sha256').update(pages[0].text).digest('hex'));assert.equal(profile.preferencesSource,'user-configuration');assert.match(buildCoopDraftPrompt({profile,role:{title:'Example role',employer:'Example organization',description:'Work with volunteers on a community garden.',sourceUrl:'https://example.test/role'}}),/exact resume excerpts/);
});
