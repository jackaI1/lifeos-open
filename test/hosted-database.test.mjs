import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {makeWorkspace} from '../src/local/workspace.ts';
import {readFile} from 'node:fs/promises';
function storage(){
 const db=new DatabaseSync(':memory:');
 const sql={get databaseSize(){return Number(db.prepare('PRAGMA page_count').get().page_count)*4096;},exec(query,...args){
  let rows=[],names=[];
  if(!args.length&&query.includes(';'))db.exec(query);
  else {const s=db.prepare(query);names=s.columns().map(c=>c.name);rows=s.all(...args.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v));}
  return {toArray:()=>rows,rowsWritten:Number(db.prepare('SELECT changes() n').get().n),rowsRead:rows.length,columnNames:names,raw:()=>rows.map(r=>names.map(n=>r[n]))};
 }};
 return {sql,transactionSync(fn){db.exec('SAVEPOINT hosted');try{const v=fn();db.exec('RELEASE hosted');return v;}catch(e){db.exec('ROLLBACK TO hosted; RELEASE hosted');throw e;}},close:()=>db.close()};
}
async function adapter(s,options){const m=await import('../src/hosted/database.ts');assert.equal(typeof m.HostedDatabase,'function','hosted storage adapter missing');return new m.HostedDatabase(s,options);}
test('hosted SQL batches are atomic and isolated across visitor stores',async()=>{
 const a=storage(),b=storage();try{const x=await adapter(a),y=await adapter(b);for(const d of [x,y])d.exec('CREATE TABLE sample(id TEXT PRIMARY KEY,value INTEGER CHECK(value>0));');
 await x.prepare('INSERT INTO sample VALUES(?,?)').bind('a',1).run();assert.equal(await y.prepare('SELECT * FROM sample').first(),null);
 await assert.rejects(()=>x.batch([x.prepare('INSERT INTO sample VALUES(?,?)').bind('b',2),x.prepare('INSERT INTO sample VALUES(?,?)').bind('c',-1)]));
 assert.equal((await x.prepare('SELECT count(*) n FROM sample').first()).n,1);
 }finally{a.close();b.close();}
});
test('fictional seed uses an injected asset loader and remains idempotent',async()=>{
 const s=storage();try{const db=await adapter(s),seen=[];const load=async (path,encoding)=>{seen.push(path);return readFile(path,encoding);};await makeWorkspace(db,{readAsset:load});
 assert.ok(seen.includes('src/cloud/schema.sql'));assert.ok(seen.includes('public/demo-slides.pdf'));
 const before=(await db.prepare('SELECT count(*) n FROM records').first()).n;await makeWorkspace(db,{readAsset:load});assert.equal((await db.prepare('SELECT count(*) n FROM records').first()).n,before);
 }finally{s.close();}
});
test('storage cap rejects a write and rolls it back atomically',async()=>{
 const s=storage();try{const db=await adapter(s);db.exec('CREATE TABLE sample(value BLOB);');db.maxBytes=s.sql.databaseSize+4096;
 await assert.rejects(()=>db.prepare('INSERT INTO sample VALUES(?)').bind(new Uint8Array(100000)).run(),/storage limit/i);
 assert.equal((await db.prepare('SELECT count(*) n FROM sample').first()).n,0);
 }finally{s.close();}
});

test('visitor exports exclude platform-internal storage',async()=>{const s=storage();try{const db=await adapter(s);db.exec(`CREATE TABLE _cf_KV(value TEXT); INSERT INTO _cf_KV VALUES('secret visitor credential'); CREATE TABLE records(id TEXT);`);const {createBackup}=await import('../src/local/backup-data.ts');const b=await createBackup(db);assert.ok(!Object.keys(b.tables).some(k=>k.startsWith('_')));}finally{s.close();}});
