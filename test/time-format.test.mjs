import test from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../public/ui.js';
import * as preferences from '../public/workspace-preferences.js';
import {recordData} from '../src/server/validation.mjs';
import {createService} from '../src/local/service.ts';
import {timeValue,replaceTime} from '../public/schedule-edit.js';
import {formatTimer} from '../public/task-time.js';

test('clock preference defaults to 24-hour and applies to shared display functions',()=>{
 preferences.applyWorkspacePreferences({}, {dataset:{}});
 assert.equal(ui.formatTime('13:30'),'13:30');
 assert.equal(ui.formatTime('2026-10-28T17:30:00Z'),'13:30');
 assert.equal(ui.compactTime('00:05'),'00:05');
 preferences.applyWorkspacePreferences({timeFormat:'12h'}, {dataset:{}});
 for(const [clock,expected] of [['00:00','12:00 AM'],['12:00','12:00 PM'],['13:30','1:30 PM'],['09:05','9:05 AM'],['23:59','11:59 PM'],['1:30','1:30 AM']])assert.equal(ui.formatTime(clock),expected);
 assert.equal(ui.compactTime('12:45'),'12:45 PM');
});
test('clock format respects workspace timezone and daylight saving transitions',()=>{
 preferences.applyWorkspacePreferences({timeFormat:'12h'}, {dataset:{}});
 ui.setDisplayTimeZone('America/Toronto');
 for(const [value,expected] of [['2026-03-08T06:30:00Z','1:30 AM'],['2026-03-08T07:30:00Z','3:30 AM'],['2026-11-01T05:30:00Z','1:30 AM'],['2026-11-01T06:30:00Z','1:30 AM']])assert.equal(ui.formatTime(value),expected);
 ui.setDisplayTimeZone('UTC');assert.equal(ui.formatTime('2026-10-28T17:30:00Z'),'5:30 PM');ui.setDisplayTimeZone('America/Toronto');
});
test('malformed clocks stay absent rather than displaying a fabricated time',()=>{
 for(const value of ['',null,undefined,'bad','25:00','12:60','13:30:70'])assert.equal(ui.formatTime(value),'');
});
test('native clock values, canonical edits and elapsed durations retain their formats',()=>{
 preferences.applyWorkspacePreferences({timeFormat:'12h'}, {dataset:{}});
 assert.equal(timeValue('2026-10-28T17:30:00Z'),'13:30');
 for(const value of ['13:30','1:30 pm','1:30 PM'])assert.equal(replaceTime('2026-10-28T17:30:00Z',value),'2026-10-28T17:30:00.000Z');
 assert.equal(formatTimer(5400000),'1:30:00');
});
test('time preference validates exactly the supported choices',()=>{
 for(const timeFormat of ['24h','12h'])assert.equal(recordData('settings',{timeFormat}).timeFormat,timeFormat);
 for(const timeFormat of ['',null,12,{},'__proto__','12'])assert.throws(()=>recordData('settings',{timeFormat}));
});
test('Settings API saves the time choice through the theme record and revision checks',async()=>{
 const app=await createService({database:':memory:'});
 try{
  const session=await(await app.fetch(new Request(app.origin+'/api/session'))).json();
  const read=async()=>(await(await app.fetch(new Request(app.origin+'/api/records/settings/preferences'))).json()).item;
  let record=await read();const original={...record.data};
  const save=async(version,timeFormat)=>app.fetch(new Request(app.origin+'/api/records/settings/preferences',{method:'PUT',headers:{origin:app.origin,'x-lifeos-csrf':session.csrf,'content-type':'application/json'},body:JSON.stringify({mutationId:crypto.randomUUID(),version,data:{...record.data,timeFormat}})}));
  const version=record.version;assert.equal((await save(version,'12h')).status,200);record=await read();assert.equal(record.data.timeFormat,'12h');for(const [k,v]of Object.entries(original))assert.deepEqual(record.data[k],v);
  assert.equal((await save(version,'24h')).status,409);assert.equal((await read()).data.timeFormat,'12h');assert.equal((await save(record.version,'24h')).status,200);assert.equal((await read()).data.timeFormat,'24h');
 }finally{app.close();}
});
test('time cache is a safe display fallback and bootstrap preferences win',()=>{
 const previous=globalThis.localStorage,previousDocument=globalThis.document,cache=new Map(),root={dataset:{}};
 try{globalThis.document={documentElement:root,querySelector:()=>null};globalThis.localStorage={getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v)};preferences.applyWorkspacePreferences({timeFormat:'12h'},root);assert.equal(cache.get('lifeos.timeFormat'),'12h');assert.equal(preferences.cachedTimeFormat(),'12h');preferences.applyWorkspacePreferences({},root);assert.equal(ui.formatTime('13:30'),'13:30');cache.set('lifeos.timeFormat','bad');assert.equal(preferences.cachedTimeFormat(),'24h');globalThis.localStorage={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};assert.equal(preferences.cachedTimeFormat(),'24h');assert.doesNotThrow(()=>preferences.applyWorkspacePreferences({timeFormat:'12h'},root));}finally{globalThis.localStorage=previous;globalThis.document=previousDocument;}
});

test('explicit format options are isolated for generated demo clock text',()=>{
 preferences.applyWorkspacePreferences({}, {dataset:{}});
 assert.equal(ui.formatTime('13:30',{timeFormat:'12h'}),'1:30 PM');
 assert.equal(ui.formatTime('13:30'),'13:30');
});
