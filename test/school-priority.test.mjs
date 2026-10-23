import test from 'node:test';
import assert from 'node:assert/strict';
import {rankSchoolTasks} from '../src/domain/school.mjs';
import {scenarioRecords,STORY_NOW} from '../demo/scenarios.mjs';

const now='2026-10-06T14:00:00.000Z';
const rank=tasks=>rankSchoolTasks({tasks,now,settings:{timeZone:'America/Toronto'}}).ranked;
const task=(id,dueDate,remainingMinutes,difficulty=3)=>({id,title:id,status:'todo',dueDate,remainingMinutes,difficulty});

test('priority reranks every assignment by remaining effort per day rather than only promoting one item',()=>{
  const tasks=[task('short-soon','2026-10-07',10),task('long-later','2026-10-10',240,5),task('medium-later','2026-10-09',120,4),task('small-tomorrow','2026-10-08',20,1)];
  assert.deepEqual(rank(tasks).map(t=>t.id),['long-later','medium-later','short-soon','small-tomorrow']);
  assert.deepEqual(rank([...tasks].reverse()).map(t=>t.id),['long-later','medium-later','short-soon','small-tomorrow']);
});

test('difficulty weighs comparable workload but stays bounded and uses remaining work',()=>{
  assert.deepEqual(rank([task('easy','2026-10-08',60,1),task('hard','2026-10-08',60,5)]).map(t=>t.id),['hard','easy']);
  assert.deepEqual(rank([task('absurd-difficulty','2026-10-08',10,1000000),task('more-work','2026-10-08',60,1)]).map(t=>t.id),['more-work','absurd-difficulty']);
  assert.deepEqual(rank([{...task('nearly-done','2026-10-08',5,5),estimatedMinutes:500},task('remaining-work','2026-10-08',60,1)]).map(t=>t.id),['remaining-work','nearly-done']);
});

test('unknown deadlines remain after verified obligations and blocked work stays separate',()=>{
  const ranked=rank([task('unknown',undefined,100000,5),task('blocked','2026-10-07',100000,5),task('known','2026-10-10',10,1),task('invalid','2026-02-30',9999,5)].map(t=>t.id==='blocked'?{...t,status:'blocked'}:t));
  assert.deepEqual(ranked.map(t=>t.id),['known','invalid','unknown','blocked']);
  assert.equal(ranked.find(t=>t.id==='invalid').dueKnown,false);
  assert.equal(ranked.find(t=>t.id==='unknown').dueKnown,false);
});

test('elapsed deadlines stay visible first and tied priorities use deadline then stable id',()=>{
  assert.deepEqual(rank([task('a-later','2026-10-08',60),task('z-earlier','2026-10-07',30)]).map(t=>t.id),['z-earlier','a-later']);
  assert.deepEqual(rank([task('large-future','2026-10-07',10000,5),task('overdue','2026-10-05',10,1),task('b','2026-10-08',60),task('a','2026-10-08',60)]).map(t=>t.id),['overdue','large-future','a','b']);
});

test('date-only work stays date-only while a timed deadline uses actual remaining time',()=>{
  const ranked=rank([task('date-only','2026-10-06',10),{...task('timed',undefined,10),dueAt:'2026-10-06T15:00:00Z'}]);
  assert.deepEqual(ranked.map(t=>t.id),['timed','date-only']);
  assert.equal(ranked[1].dueTimeKnown,false);
  assert.equal(ranked[1].dueAt,undefined);
});

test('an unknown-date prerequisite can inherit the verified dependent urgency without acquiring a deadline',()=>{
  const ranked=rank([task('small-known','2026-10-07',5),task('prerequisite',undefined,10),{...task('dependent','2026-10-07',240,5),dependencies:['prerequisite']}]);
  assert.deepEqual(ranked.map(t=>t.id),['prerequisite','small-known','dependent']);
  assert.equal(ranked[0].dueKnown,false);
  assert.equal(ranked[0].requiredFor,'dependent');
});

test('fictional demo shows several changed positions between priority and deadline order',()=>{
  const tasks=scenarioRecords().task.map(r=>({...r.data,id:r.id}));
  const ranked=rankSchoolTasks({tasks,now:STORY_NOW,settings:{timeZone:'America/Toronto'}}).ranked;
  assert.ok(tasks.filter(t=>t.dueAt||t.dueDate).length>=4);
  assert.deepEqual(ranked.map(t=>t.id),['demo-task-model-comparison','demo-task-watershed-diagram','demo-task-outline','demo-task-reading','demo-task-date-unverified']);
});

// A deliberate focus choice affects dispatch, while the full background ranking stays useful.
test('a focused task remains the dispatch choice without pinning the priority order',()=>{
  const result=rankSchoolTasks({tasks:[task('focused','2026-10-08',10),task('larger','2026-10-10',240,5)],now,capacity:[{start:now,end:'2026-10-06T15:00:00.000Z'}],activeTaskId:'focused',settings:{timeZone:'America/Toronto'}});
  assert.deepEqual(result.ranked.map(t=>t.id),['larger','focused']);
  assert.equal(result.next.id,'focused');
  assert.equal(result.interruptFocus,false);
});
