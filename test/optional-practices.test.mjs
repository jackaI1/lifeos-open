import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDayPlan,buildToday} from '../src/domain/index.mjs';
import {routesFor} from '../public/routes.js';
import {scenarioRecords} from '../demo/scenarios.mjs';
import {LocalDatabase} from '../src/local/database.ts';
import {makeWorkspace} from '../src/local/workspace.ts';
import {createService} from '../src/local/service.ts';
import {RecordPlan} from '../src/cloud/plan.mjs';
import {scheduleTick} from '../src/runtime/schedule.mjs';

const isPractice=item=>['devotional','prayer'].includes(item.kind);
const settings={timeZone:'America/Toronto'};

test('navigation keeps both manual practices directly after daily photos',()=>{
 for(const environment of ['production','beta']){
  const navigation=routesFor(environment).map(([id])=>id),photos=navigation.indexOf('photos');
  assert.deepEqual(navigation.slice(photos+1,photos+3),['devotional','prayer']);
  assert.ok(navigation.includes('school'));
 }
});

test('fictional fixtures do not claim a devotional or prayer completion',()=>{
 assert.deepEqual(scenarioRecords().spiritual,[]);
});

test('default plans reserve no practice time on weekdays, Fridays or weekends',()=>{
 for(const date of ['2026-10-20','2026-10-23','2026-10-24','2026-10-25']){
  const plan=buildDayPlan({date,now:date+'T14:00:00Z',settings});
  assert.deepEqual(plan.blocks.filter(isPractice),[],date);
  assert.deepEqual(plan.campusSlots,[],date);
  assert.deepEqual(plan.unscheduled.filter(isPractice),[],date);
  assert.ok(plan.blocks.filter(b=>b.kind==='commute').every(b=>!b.prayerPlan));
 }
});

test('unfinished optional practices never interrupt school, commute or sleep',()=>{
 const task={id:'school-task',data:{title:'Read the assignment',status:'todo',remainingMinutes:30,nextStepMinutes:10,nextStep:'Read one page'}};
 for(const [now,want] of [['2026-10-20T14:00:00Z','school'],['2026-10-20T12:05:00Z','commute'],['2026-10-21T02:15:00Z','rest']]){
  const view=buildToday({now,records:{task:[task]},settings});
  assert.equal(view.nowAction.kind,want,now);
  assert.deepEqual(view.timeline.filter(isPractice),[],now);
  assert.notEqual(view.nowAction.target?.route,'prayer');
 }
});

test('manual completion remains visible without extending the school day',()=>{
 const completion={id:'owner-devotional',data:{practice:'devotional',date:'2026-10-20',complete:true,completedAt:'2026-10-20T14:00:00Z',plan:'B',context:'planned-school-time',schoolMinutes:30}};
 const records={spiritual:[completion]},original=structuredClone(records);
 const view=buildToday({now:'2026-10-20T15:00:00Z',records,settings});
 assert.equal(view.releaseAt,'2026-10-20T21:00:00.000Z');
 assert.equal(view.extensionMinutes,0);
 assert.equal(view.spiritual.devotional.complete,true);
 assert.equal(view.timeline.find(i=>i.id==='completed:owner-devotional')?.state,'completed');
 assert.deepEqual(records,original);
});

test('practice scheduling requires an explicit boolean opt-in',()=>{
 const input={date:'2026-10-20',now:'2026-10-20T14:00:00Z'};
 for(const value of [undefined,false,'true',1]){
  const plan=buildDayPlan({...input,settings:{...settings,spiritualPracticesEnabled:value}});
  assert.deepEqual(plan.campusSlots,[],String(value));
 }
 const optedIn=buildDayPlan({...input,settings:{...settings,spiritualPracticesEnabled:true}});
 assert.ok(optedIn.campusSlots.some(isPractice));
});

test('default notification scheduling does not require optional practices',()=>{
 const store=new RecordPlan({kinds:['settings','push-subscription','spiritual','calendar-event','task'],records:[{kind:'push-subscription',id:'synthetic-device',data:{disabled:false}}]});
 store.transaction=fn=>fn();store.jobs=()=>[];
 scheduleTick({store,config:{environment:'beta'},now:'2026-10-20T14:00:00Z'});
 assert.deepEqual(store.queued,[]);
});

test('explicit hourly prayer reminders remain available without requiring a daily practice',()=>{
 const store=new RecordPlan({kinds:['settings','push-subscription','spiritual','calendar-event','task'],records:[{kind:'settings',id:'preferences',data:{hourlyPrayerReminder:true}},{kind:'push-subscription',id:'synthetic-device',data:{disabled:false}}]});
 store.transaction=fn=>fn();store.jobs=()=>[];
 scheduleTick({store,config:{environment:'beta'},now:'2026-10-20T14:00:00Z'});
 assert.deepEqual(store.queued.map(job=>job.payload.notice),['hourly-prayer']);
});

test('optional practice defaults preserve calendar commitments and school boundaries',()=>{
 const event={id:'seminar',calendarId:'school-calendar',title:'Design seminar',start:'2026-10-20T14:00:00Z',end:'2026-10-20T15:00:00Z'};
 const view=buildToday({now:'2026-10-20T14:15:00Z',events:[event],settings:{...settings,allowedCalendarIds:['school-calendar'],schoolCalendarIds:['school-calendar']}});
 assert.equal(view.nowAction.kind,'calendar');
 assert.equal(view.nowAction.title,'Design seminar');
 assert.equal(view.timeline.find(item=>item.id==='plan:calendar:seminar')?.end,'2026-10-20T15:00:00.000Z');
 assert.deepEqual(view.schoolWindow,{start:'2026-10-20T12:30:00.000Z',end:'2026-10-20T21:00:00.000Z'});
 assert.ok(view.academicMinutes>0);
});

test('workspace initialization preserves an explicit completion and does not seed another',async()=>{
 const db=new LocalDatabase(':memory:');
 try{
  await makeWorkspace(db,{now:new Date('2026-10-20T14:00:00Z')});
  assert.equal((await db.prepare("SELECT count(*) n FROM records WHERE kind='spiritual'").first()).n,0);
  const data=JSON.stringify({practice:'prayer',date:'2026-10-20',complete:true,completedAt:'2026-10-20T14:15:00Z'});
  await db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('spiritual','owner-prayer',data,1,'2026-10-20T14:15:00Z','2026-10-20T14:15:00Z').run();
  await makeWorkspace(db,{now:new Date('2026-10-21T14:00:00Z')});
  assert.deepEqual((await db.prepare("SELECT id,data FROM records WHERE kind='spiritual'").all()).results.map(row=>({...row})),[{id:'owner-prayer',data}]);
 }finally{db.close();}
});

test('manual devotional edits and prayer completion work with scheduling disabled',async()=>{
 const app=await createService({database:':memory:',env:{DEMO_CLOCK:'2026-10-20T14:00:00Z'}});
 try{
  const session=await(await app.fetch(new Request(app.origin+'/api/session'))).json();
  const api=async(path,method='GET',body)=>{
   const response=await app.fetch(new Request(app.origin+path,{method,headers:{origin:app.origin,'content-type':'application/json','x-lifeos-csrf':session.csrf},body:body===undefined?undefined:JSON.stringify({...body,mutationId:crypto.randomUUID()})}));
   assert.equal(response.status,200,await response.clone().text());return response.json();
  };
  const preferences=(await api('/api/records/settings/preferences')).item;
  await api('/api/records/settings/preferences','PUT',{version:preferences.version,data:{...preferences.data,spiritualPracticesEnabled:false}});
  const entry=(await api('/api/devotionals/2026-10-20')).entry;
  const saved=await api('/api/devotionals/2026-10-20','PUT',{version:entry.version,date:'2026-10-20',passage:entry.passage,bookId:entry.bookId,chapter:entry.chapter,type:entry.type,points:['An explicit manual reflection.','','','','','',''],complete:false});
  assert.equal(saved.entry.points[0],'An explicit manual reflection.');
  await api('/api/actions/spiritual-complete','POST',{practice:'prayer',date:'2026-10-20',complete:true,observedAt:'2026-10-20T14:00:00Z'});
  const bootstrap=await api('/api/bootstrap');
  assert.equal(bootstrap.today.spiritual.prayer.complete,true);
  assert.equal(bootstrap.today.timeline.filter(isPractice).length,1);
  assert.equal(bootstrap.today.timeline.find(isPractice).state,'completed');
 }finally{app.close();}
});
