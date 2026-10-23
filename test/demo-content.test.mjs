import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalDatabase} from '../src/local/database.ts';
import {makeWorkspace} from '../src/local/workspace.ts';

const now=new Date('2026-10-22T14:00:00Z');
const row=async(db,kind,id)=>{const r=await db.prepare('SELECT * FROM records WHERE kind=? AND id=?').bind(kind,id).first();return r&&{...r,data:JSON.parse(r.data)};};
async function fixture(fn){const db=new LocalDatabase(':memory:');try{await makeWorkspace(db,{now});await fn(db);}finally{db.close();}}
test('demo has the published 18-week plan, empty devotional answers and selected portfolio',()=>fixture(async db=>{
 const training=await row(db,'training','baseline'),source=await row(db,'training-source','fictional-plan');
 assert.equal(source.data.sourceWeeks.length,18);assert.match(source.data.source.title,/Hansons/);
 assert.equal(new Date(training.data.raceDate+'T12:00Z').getUTCDay(),0);
 assert.deepEqual((await row(db,'devotional','2026-10-22')).data.points,Array(7).fill(''));
 assert.equal((await row(db,'private-friend','demo-maya')).data.name,'John Doe');
 const projects=(await db.prepare("SELECT data FROM records WHERE kind='project'").all()).results.map(r=>JSON.parse(r.data)).filter(p=>!p.archived);
 assert.equal(projects.length,7);assert.equal(projects.filter(p=>p.status==='completed').length,6);
 assert.equal(projects.find(p=>p.status==='active').title,'LifeOS Open');
}));
test('existing demo updates untouched examples but preserves edits, originals and uploads',()=>fixture(async db=>{
 await db.prepare("DELETE FROM meta WHERE key='demo-content-revision'").run();
 await db.prepare("UPDATE records SET data=?,version=1 WHERE kind='private-friend' AND id='demo-maya'").bind(JSON.stringify({name:'Maya Chen',text:'Fictional study group partner. Ask about the community garden.'})).run();
 await db.prepare("UPDATE records SET data=?,version=2 WHERE kind='devotional'").bind(JSON.stringify({date:'2026-10-22',points:['My own writing'],complete:false})).run();
 const before=await row(db,'private-note','demo-note'),objects=await db.prepare('SELECT COUNT(*) AS n FROM private_objects').first();
 await makeWorkspace(db,{now:new Date('2026-10-23T14:00:00Z')});
 assert.equal((await row(db,'private-friend','demo-maya')).data.name,'John Doe');
 assert.deepEqual((await row(db,'devotional','2026-10-22')).data.points,['My own writing']);
 assert.deepEqual(await row(db,'private-note','demo-note'),before);
 assert.deepEqual(await db.prepare('SELECT COUNT(*) AS n FROM private_objects').first(),objects);
 assert.equal(JSON.parse((await db.prepare("SELECT data FROM _demo_seed_originals WHERE kind='private-friend' AND id='demo-maya'").first()).data).name,'Maya Chen');
 const snapshot=JSON.stringify((await db.prepare('SELECT * FROM records ORDER BY kind,id').all()).results);
 await makeWorkspace(db,{now:new Date('2026-10-24T14:00:00Z')});
 assert.equal(JSON.stringify((await db.prepare('SELECT * FROM records ORDER BY kind,id').all()).results),snapshot);
}));

test('untouched old training and devotional fixtures upgrade without changing completed runs',()=>fixture(async db=>{
 await db.prepare("DELETE FROM meta WHERE key='demo-content-revision'").run();
 const set=async(kind,id,data)=>db.prepare('UPDATE records SET data=?,version=1 WHERE kind=? AND id=?').bind(JSON.stringify(data),kind,id).run();
 await set('training','baseline',{raceDate:'2027-01-14',goalMinutes:150,notes:'Fictional fitness plan; edit for your own ability.'});
 await set('training-source','fictional-plan',{source:{title:'Fictional gentle activity reference'},sourceWeeks:[]});
 await set('devotional','2026-10-22',{points:['Notice something good.','Consider the context.','Reflect on kindness.','Name a human need.','Choose one practical act.','Listen with care.','Take a quiet moment.'],complete:false});
 await db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('run','my-run',JSON.stringify({date:'2026-10-22',distanceKm:5,durationMinutes:30}),1,now.toISOString(),now.toISOString()).run();
 const run=await row(db,'run','my-run');await makeWorkspace(db,{now});
 assert.equal((await row(db,'training-source','fictional-plan')).data.sourceWeeks.length,18);
 assert.deepEqual((await row(db,'devotional','2026-10-22')).data.points,Array(7).fill(''));
 assert.deepEqual(await row(db,'run','my-run'),run);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM _demo_seed_originals WHERE kind IN ('training','training-source','devotional')").first()).n,3);
}));
test('deleted examples stay deleted when a previous demo is upgraded',async()=>{
 const {createService}=await import('../src/local/service.ts');
 const app=await createService({database:':memory:',origin:'http://127.0.0.1:18749',now});
 try{
  const session=await(await app.fetch(new Request(app.origin+'/api/session'))).json();
  for(const [kind,id]of [['task','demo-task-outline'],['prayer-note','demo-prayer'],['project','demo-portfolio-kitchen']]){
   const r=await row(app.db,kind,id),response=await app.fetch(new Request(app.origin+'/api/deleted',{method:'POST',headers:{origin:app.origin,'x-lifeos-csrf':session.csrf,'content-type':'application/json'},body:JSON.stringify({kind,id,version:r.version,mutationId:crypto.randomUUID()})}));
   assert.equal(response.status,200,await response.text());
  }
  await app.db.prepare("DELETE FROM meta WHERE key='demo-content-revision'").run();await makeWorkspace(app.db,{now});
  for(const [kind,id]of [['task','demo-task-outline'],['prayer-note','demo-prayer'],['project','demo-portfolio-kitchen']])assert.equal(await row(app.db,kind,id),null);
  assert.equal((await app.db.prepare('SELECT COUNT(*) AS n FROM retired_records').first()).n,3);
 }finally{app.close();}
});
