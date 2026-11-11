import test from 'node:test';
import assert from 'node:assert/strict';
import {buildToday, buildDayPlan, buildReminderDay, normalizeCalendars, zonedDateTime} from '../src/domain/index.mjs';
import {moveConsequences, replanRemaining} from '../public/planning-actions.js';
import {assistantContext} from '../src/shared/assistant-contract.mjs';

const date='2026-09-08', next='2026-09-09', at=(time,day=date)=>zonedDateTime(day,time,{timeZone:'America/Toronto'});
const settings={allowedCalendarIds:['personal','school-a','school-b'],schoolCalendarIds:['school-a','school-b']};
const event=(id,extra={})=>({id,title:'Calendar '+id,calendarId:'personal',start:{date},end:{date:next},...extra});
const timed=(id,start,end)=>event(id,{start:at(start),end:at(end)});
const view=(events,extra={})=>buildToday({now:at('10:00'),date,events,settings,records:{},...extra});
const normalize=events=>normalizeCalendars({events,...settings});

test('two personal all-day events are reminders, never overlap warnings or time blocks',()=>{
 const v=view([event('one'),event('two')]);
 assert.equal(v.calendarConflicts.length,0);assert.equal(v.conflicts.length,0);
 assert.equal(v.calendar.busy.length,0);assert.equal(v.calendar.busyIntervals.length,0);
 assert.ok(!v.alerts.some(a=>a.kind==='calendar-overlap'));
 assert.ok(!v.timeline.some(i=>i.kind==='calendar'));assert.ok(!v.schedule.some(i=>i.kind==='calendar'));
 assert.deepEqual(v.calendarReminders.map(i=>i.id),['one','two']);
});
test('an all-day event never conflicts with a timed commitment, which remains Now',()=>{
 const v=view([event('one'),timed('appointment','09:30','10:30')]);
 assert.equal(v.calendarConflicts.length,0);assert.equal(v.nowAction.kind,'calendar');
 assert.equal(v.nowAction.target.eventId,'appointment');assert.equal(v.calendarReminders.length,1);
});
test('two genuinely overlapping timed events retain the existing warning and Now conflict',()=>{
 const v=view([timed('one','09:30','10:30'),timed('two','09:45','11:00')]);
 assert.equal(v.calendarConflicts.length,1);assert.equal(v.alerts.filter(a=>a.kind==='calendar-overlap').length,1);
 assert.equal(v.nowAction.kind,'conflict');assert.equal(v.nowAction.title,'Two commitments overlap');
});
for(const [label,extra] of [
 ['explicit flag',{allDay:true,start:at('00:00'),end:at('00:00',next)}],
 ['ISO local midnight',{start:date+'T00:00:00-04:00',end:next+'T00:00:00-04:00'}],
 ['shifted Toronto midnight',{start:at('00:00'),end:at('00:00',next)}],
 ['UTC midnight expressed in local offsets',{start:'2026-09-07T20:00:00-04:00',end:'2026-09-08T20:00:00-04:00'}],
 ['source time zone',{start:{dateTime:date+'T07:00:00Z',timeZone:'America/Los_Angeles'},end:{dateTime:next+'T07:00:00Z',timeZone:'America/Los_Angeles'}}],
 ['multi-day',{start:{date:'2026-09-07'},end:{date:'2026-09-10'}}],
 ['multi-day ISO',{start:'2026-09-07T00:00:00-04:00',end:'2026-09-10T00:00:00-04:00'}],
 ['DST spring',{start:'2026-03-08T05:00:00Z',end:'2026-03-09T04:00:00Z'}],
 ['DST fall',{start:'2026-11-01T04:00:00Z',end:'2026-11-02T05:00:00Z'}]
])test(label+' is all-day and excluded even with blocksTime true',()=>{
 const v=normalize([event('one',{...extra,blocksTime:true})]);assert.equal(v.events[0].allDay,true);assert.equal(v.busy.length,0);
});
test('a non-midnight start ending at midnight stays timed; dateTime takes precedence over date',()=>{
 for(const extra of [{start:at('23:00'),end:at('00:00',next)},{start:{date,dateTime:at('09:00')},end:{date:next,dateTime:at('10:00')}}]){
  const v=normalize([event('timed',extra)]);assert.equal(v.events[0].allDay,false);assert.equal(v.busy.length,1);
 }
});
test('multi-day reminders cover civil days with an exclusive end, never the following operational morning',()=>{
 const events=[event('multi',{start:{date:'2026-09-07'},end:{date:'2026-09-10'}})];
 for(const day of ['2026-09-06','2026-09-07',date,next,'2026-09-10']){
  const v=view(events,{date:day,now:at('10:00',day)});
  assert.equal(v.calendarReminders?.length,day>='2026-09-07'&&day<'2026-09-10'?1:0,day);
 }
 assert.equal(view([event('tomorrow',{start:{date:next},end:{date:'2026-09-10'}})]).calendarReminders.length,0);
});
test('all-day school feed disagreements produce no time-based source warnings',()=>{
 const v=view([event('a',{calendarId:'school-a',iCalUID:'shared'}),event('b',{calendarId:'school-b',iCalUID:'shared',end:{date:'2026-09-10'}})]);
 assert.equal(v.sourceConflicts.length,0);assert.equal(v.calendarConflicts.length,0);
});
test('free-time, current school capacity, Now, stepping and notification plans match a day without all-day events',()=>{
 const events=[event('one'),event('two')],v=view(events),baseline=view([]);
 assert.deepEqual(v.availability,baseline.availability);assert.deepEqual(v.nowAction,baseline.nowAction);
 assert.deepEqual(v.timeline,baseline.timeline);assert.deepEqual(v.nextTransition,baseline.nextTransition);
 assert.deepEqual(buildReminderDay({now:at('10:00'),date,events,records:{},settings}),buildReminderDay({now:at('10:00'),date,events:[],records:{},settings}));
 const direct=buildDayPlan({now:at('10:00'),date,events:[event('raw',{start:at('00:00'),end:at('00:00',next)})],settings});
 assert.ok(!direct.blocks.some(b=>b.id==='raw'));
});
test('existing LifeOS reminder identity or exact title prevents duplicate projection, including completed reminders',()=>{
 const records={'reminder-list':[{id:'list',data:{title:'Personal'}}],reminder:[
  {id:'native',data:{listId:'list',title:'Calendar one',dueDate:date}},
  {id:'linked',data:{listId:'list',title:'Renamed reminder',calendarEventId:'two',completed:true}}
 ]};
 const v=view([event('one'),event('two'),event('three')],{records});assert.deepEqual(v.calendarReminders.map(r=>r.id),['three']);
 assert.equal(v.calendarReminders[0].readOnly,true);assert.equal(v.calendarReminders[0].allDay,true);
});
test('an already-visible overdue LifeOS reminder is not repeated by a matching calendar reminder',()=>{
 const records={'reminder-list':[{id:'list',data:{}}],reminder:[{id:'native',data:{listId:'list',title:'Calendar one',dueDate:'2026-09-01'}}]};
 const v=view([event('one')],{records});assert.equal(v.dueReminders.length,1);assert.equal(v.calendarReminders.length,0);
});
test('a future native reminder cannot hide today on an ongoing multi-day calendar reminder',()=>{
 const records={'reminder-list':[{id:'list',data:{}}],reminder:[{id:'native',data:{listId:'list',title:'Calendar one',dueDate:next}}]};
 const v=view([event('one',{end:{date:'2026-09-10'}})],{records});assert.equal(v.dueReminders.length,0);assert.equal(v.calendarReminders.length,1);
});
test('cancelled all-day events disappear, transparent all-day reminders stay visible, repeated instances appear once',()=>{
 const v=view([event('cancelled',{status:'cancelled'}),event('transparent',{transparency:'transparent'}),event('transparent',{transparency:'transparent'})]);
 assert.deepEqual(v.calendarReminders?.map(r=>r.id),['transparent']);
});
test('all-day entries never constrain moves or replanning and are never moved themselves',()=>{
 const all={...event('all',{start:at('00:00'),end:at('00:00',next)}),kind:'calendar',state:'planned'},flex={id:'flex',kind:'exercise',title:'Exercise',start:at('09:00'),end:at('09:30'),state:'planned'};
 assert.deepEqual(moveConsequences(flex,{start:at('10:00'),end:at('10:30')},[all,flex]),[]);
 assert.deepEqual(replanRemaining([all,flex],at('10:00')),replanRemaining([flex],at('10:00')));
 assert.deepEqual(replanRemaining([{...all,kind:'reminder'}],at('10:00')),[]);
});
test('an unflagged project with an unrecorded date-only endpoint retains its move conflict checks',()=>{
 const project={id:'project',kind:'project',start:date,end:at('11:00'),state:'planned'};
 const fixed={id:'fixed',kind:'calendar',title:'Appointment',start:at('10:00'),end:at('10:30'),state:'planned'};
 assert.deepEqual(moveConsequences(project,{start:at('09:45'),end:at('10:15')},[project,fixed]).map(i=>i.id),['fixed']);
});
test('assistant schedule context carries all-day reminders without timed entries or schedule adjustment targets',()=>{
 const v=view([event('one')]),c=assistantContext({scope:'today',now:at('10:00'),records:{},days:[v]});
 assert.ok(!c.schedule[0].entries.some(e=>e.id.includes('one')));
 assert.deepEqual(c.schedule[0].reminders.map(r=>({id:r.id,title:r.title,readOnly:r.readOnly})),[{id:'one',title:'Calendar one',readOnly:true}]);
 assert.equal(c.schedule[0].reminders[0].start,undefined);
});
