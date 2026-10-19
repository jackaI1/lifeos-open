import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalDatabase} from '../src/local/database.ts';
import {makeWorkspace} from '../src/local/workspace.ts';
import {createService} from '../src/local/service.ts';

test('SQLite D1 compatibility rolls a failed batch back', async()=>{
 const db=new LocalDatabase(':memory:');
 try {
  db.exec('CREATE TABLE sample(id TEXT PRIMARY KEY,value INTEGER CHECK(value>0))');
  await assert.rejects(()=>db.batch([db.prepare('INSERT INTO sample VALUES(?,?)').bind('a',1),db.prepare('INSERT INTO sample VALUES(?,?)').bind('b',-1)]));
  assert.equal((await db.prepare('SELECT count(*) n FROM sample').first()).n,0);
 }finally{db.close();}
});
test('fictional workspace has all major feature domains and seeds only once',async()=>{
 const db=new LocalDatabase(':memory:');
 try{
  await makeWorkspace(db);
  const rows=(await db.prepare('SELECT DISTINCT kind FROM records').all()).results.map(r=>r.kind);
  for(const k of ['course','task','meal','project','private-friend','private-note','private-journal','private-daily-photo','lecture','lecture-page','finance-transaction','prayer-note','devotional','reminder'])assert.ok(rows.includes(k),k);
  const before=(await db.prepare('SELECT count(*) n FROM records').first()).n;await makeWorkspace(db);
  assert.equal((await db.prepare('SELECT count(*) n FROM records').first()).n,before);
 }finally{db.close();}
});
test('local API supports session, complete bootstrap, notes, photos, lecture and AI',async()=>{
 const app=await createService({database:':memory:',origin:'http://127.0.0.1:18743'});
 try{
  const get=async path=>{const r=await app.fetch(new Request(app.origin+path));assert.equal(r.status,200,path);return r.json();};
  const session=await get('/api/session');assert.equal(session.mode,'demo');
  const b=await get('/api/bootstrap');assert.ok(b.records.course.length);assert.ok(b.today.timeline.length);
  for(const p of ['/api/private-notes','/api/private-friends','/api/private-journal/entries','/api/daily-photos','/api/finances','/api/devotionals','/api/quota'])await get(p);
  const lectures=await get('/api/lectures?course=demo-course-design');assert.ok(lectures.items.length);
  const lecture=await get('/api/lectures/'+lectures.items[0].id);assert.ok(lecture.pages.length);assert.ok(lecture.clips.length);
  const post=async(path,body)=>{const r=await app.fetch(new Request(app.origin+path,{method:'POST',headers:{'content-type':'application/json',origin:app.origin,'x-lifeos-csrf':session.csrf},body:JSON.stringify({...body,mutationId:crypto.randomUUID()})}));assert.equal(r.status,200,await r.clone().text());return r.json();};
  const thread=await post('/api/assistant/threads',{id:crypto.randomUUID(),scope:'academics'});
  await post('/api/assistant/threads/'+thread.item.id+'/messages',{message:'Explain feedback loops',sentAt:new Date().toISOString()});
  const answer=await get('/api/assistant/threads/'+thread.item.id);
  assert.ok(answer.messages.some(m=>m.data.role==='assistant'&&m.data.mock===true&&m.data.text.length>40));
  const denied=await app.fetch(new Request(app.origin+'/api/actions/backup',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));assert.equal(denied.status,403);
 }finally{app.close();}
});
test('seeded lecture page satisfies the production notebook schema and has timed ink',async()=>{
 const {validatePage}=await import('../public/lecture-core.js');
 const db=new LocalDatabase(':memory:');try{await makeWorkspace(db);const row=await db.prepare("SELECT content FROM local_objects WHERE id='demo-page-file'").first();const page=JSON.parse(Buffer.from(row.content).toString());assert.doesNotThrow(()=>validatePage(page));assert.ok(page.strokes.length>0);assert.ok(page.strokes[0].audioSegmentId);}finally{db.close();}
});
test('seeded note and contact conform to their editor contracts',async()=>{
 const {validContactSchedule}=await import('../public/friend-schedule.js');const db=new LocalDatabase(':memory:');try{await makeWorkspace(db);const n=JSON.parse((await db.prepare("SELECT data FROM records WHERE kind='private-note'").first()).data);assert.ok(Array.isArray(n.imageIds));const f=JSON.parse((await db.prepare("SELECT data FROM records WHERE kind='private-friend'").first()).data);assert.doesNotThrow(()=>validContactSchedule(f.schedule));assert.ok(Array.isArray(f.memories));}finally{db.close();}
});
