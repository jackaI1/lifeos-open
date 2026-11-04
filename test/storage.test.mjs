import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalDatabase} from '../src/local/database.ts';

// This contract must catch partial commits and SQLite/PostgreSQL value drift.
for(const backend of ['sqlite',...(process.env.TEST_DATABASE_URL?['postgres']:[])]){
 test(backend+' storage contract: rollback, JSON types, bytes and revisions',async()=>{
  const {openTestDatabase}=await import('./helpers/database.mjs');
  const db=await openTestDatabase(backend);
  try{
   const {makeWorkspace}=await import('../src/local/workspace.ts');
   await makeWorkspace(db,{demo:false});
   await db.exec('CREATE TABLE sample(id TEXT PRIMARY KEY,value INTEGER CHECK(value>0),content BLOB)');
   await assert.rejects(()=>db.batch([db.prepare('INSERT INTO sample VALUES(?,?,?)').bind('a',1,Buffer.from([0,255])),db.prepare('INSERT INTO sample VALUES(?,?,?)').bind('b',-1,null)]));
   assert.equal(await db.prepare('SELECT count(*) n FROM sample').first('n'),0);
   await db.prepare('INSERT INTO sample VALUES(?,?,?)').bind("? ' ; --",2,Buffer.from([0,255])).run();
   assert.deepEqual([...await db.prepare('SELECT content FROM sample WHERE id=?').bind("? ' ; --").first('content')],[0,255]);
   const stamp=new Date().toISOString();
   await db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('task','types',JSON.stringify({archived:false,version:2,points:['yes'],nested:{value:'x'}}),1,stamp,stamp).run();
   const row=await db.prepare("SELECT json_extract(data,'$.points[0]') point FROM records WHERE kind=? AND COALESCE(json_extract(data,'$.archived'),0)=0 AND json_extract(data,'$.version')>=?").bind('task',2).first();
   assert.equal(row.point,'yes');
   assert.equal(await db.prepare("SELECT version FROM kind_revisions WHERE kind='task'").first('version'),1);
   await assert.rejects(()=>db.batch([db.prepare("UPDATE records SET version=version+1 WHERE kind='task'"),db.prepare('INSERT INTO assertions VALUES(?,(SELECT 0))').bind('fail')]));
   assert.equal(await db.prepare("SELECT version FROM records WHERE kind='task'").first('version'),1);
   assert.equal(await db.prepare("SELECT '?' literal,? value -- ?\n").bind('safe').first('literal'),'?');
  }finally{await db.close();}
 });
}
test('SQLite exposes an atomic callback transaction',async()=>{
 const db=new LocalDatabase(':memory:');try{
  db.exec('CREATE TABLE sample(value INTEGER CHECK(value>0))');
  assert.equal(typeof db.transaction,'function');
  await assert.rejects(()=>db.transaction(async tx=>{await tx.prepare('INSERT INTO sample VALUES(?)').bind(1).run();throw Error('rollback');}));
  assert.equal(await db.prepare('SELECT count(*) n FROM sample').first('n'),0);
 }finally{db.close();}
});

test('SQL compiler preserves quoted SQL and binds without interpolation',async()=>{
 const {postgresSQL}=await import('../src/storage/sql.mjs');
 const sql=postgresSQL("SELECT 'BLOB AS INTEGER ?' label, ? value /* ? */ -- ?\n",["'; DROP TABLE records; --"]);
 assert.ok(sql.includes("'BLOB AS INTEGER ?'"));
 assert.ok(sql.includes('$1::text'));
 assert.ok(!sql.includes('DROP TABLE'));
 assert.throws(()=>postgresSQL('SELECT ?',[]),/parameter/);
});
if(process.env.TEST_DATABASE_URL){
 test('PostgreSQL transactions isolate concurrent work and release failed clients',async()=>{
  const {openTestDatabase}=await import('./helpers/database.mjs');const db=await openTestDatabase('postgres');
  try{
   await db.exec('CREATE TABLE sample(id TEXT PRIMARY KEY,value INTEGER CHECK(value>0))');
   let ready;const entered=new Promise(resolve=>{ready=resolve;});let resume;const release=new Promise(resolve=>{resume=resolve;});
   const transaction=db.transaction(async tx=>{await tx.prepare('INSERT INTO sample VALUES(?,?)').bind('uncommitted',1).run();ready();await release;throw Error('rollback');});
   const rejected=assert.rejects(transaction,/rollback/);
   try{await entered;assert.equal(await db.prepare('SELECT count(*) n FROM sample').first('n'),0);await db.prepare('INSERT INTO sample VALUES(?,?)').bind('independent',2).run();}finally{resume();}
   await rejected;
   assert.equal(await db.prepare('SELECT count(*) n FROM sample').first('n'),1);
   assert.equal(db.pool.waitingCount,0);assert.equal(db.pool.idleCount,db.pool.totalCount);
  }finally{await db.close();}
 });
 test('PostgreSQL release generation comparisons use numeric JSON ordering',async()=>{
  const {openTestDatabase}=await import('./helpers/database.mjs');const db=await openTestDatabase('postgres');
  try{
   const {makeWorkspace}=await import('../src/local/workspace.ts');await makeWorkspace(db,{demo:false});
   await db.prepare("INSERT INTO meta VALUES('generation',?)").bind('{"generation":9}').run();
   await db.prepare("INSERT INTO meta VALUES('generation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(meta.value,'$.generation')<json_extract(excluded.value,'$.generation')").bind('{"generation":10}').run();
   assert.equal(JSON.parse(await db.prepare("SELECT value FROM meta WHERE key='generation'").first('value')).generation,10);
  }finally{await db.close();}
 });
}
if(process.env.TEST_DATABASE_URL){
 test('DATABASE_URL selects PostgreSQL through the standalone service',async()=>{
  const {openTestDatabase}=await import('./helpers/database.mjs');const storage=await openTestDatabase('postgres');
  const {createService}=await import('../src/local/service.ts');let app;
  try{
   const address=new URL(process.env.TEST_DATABASE_URL);address.searchParams.set('options',storage.pool.options.options);
   app=await createService({demo:false,env:{DATABASE_URL:address.href,DEMO_SEED:'false'}});
   assert.equal(app.db.dialect,'postgres');
   const response=await app.fetch(new Request(app.origin+'/api/session'));assert.equal(response.status,200);
   assert.equal(await app.db.prepare('SELECT count(*) n FROM records').first('n'),1);
  }finally{await app?.close();await storage.close();}
 });
}

test('constructing a file adapter does not launch unawaited database work',async()=>{
 const {LocalObjects}=await import('../src/local/objects.ts');
 const db=new LocalDatabase(':memory:');let schemaCalls=0;
 const execute=db.exec.bind(db);db.exec=sql=>{schemaCalls++;return execute(sql);};
 try{new LocalObjects(db,'alex@example.invalid');assert.equal(schemaCalls,0,'DDL belongs in awaited workspace initialization');}finally{db.close();}
});
