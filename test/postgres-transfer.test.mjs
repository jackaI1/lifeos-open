import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalDatabase} from '../src/local/database.ts';
import {makeWorkspace} from '../src/local/workspace.ts';
import {openTestDatabase} from './helpers/database.mjs';
import {createBackup} from '../src/local/backup-data.ts';

test('versioned SQLite migration is idempotent and preserves existing records',async()=>{
 const db=new LocalDatabase(':memory:');try{
  assert.equal(typeof db.migrate,'function');
  await makeWorkspace(db,{demo:false});await makeWorkspace(db,{demo:false});
  assert.equal(await db.prepare('SELECT count(*) n FROM _workspace_migrations').first('n'),1);
  assert.equal(await db.prepare('SELECT count(*) n FROM records').first('n'),1);
 }finally{db.close();}
});
test('SQLite transfer preserves records and blobs and refuses reuse or corruption',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const {transferSqlite}=await import('../src/storage/transfer.ts');
 const dir=await mkdtemp(join(tmpdir(),'lifeos-transfer-')),path=join(dir,'source.sqlite');
 const source=new LocalDatabase(path),target=await openTestDatabase('postgres');
 try{
  await makeWorkspace(source);const snapshot=await createBackup(source);source.close();
  const original=await readFile(path);
  const result=await transferSqlite(path,target);
  assert.ok(result.rows>100);assert.ok(result.bytes>1000);
  assert.deepEqual((await createBackup(target)).tables,snapshot.tables);
  assert.deepEqual(await readFile(path),original);
  await assert.rejects(()=>transferSqlite(path,target),/empty/);
  const corrupt=new LocalDatabase(path);await corrupt.prepare("UPDATE local_objects SET content=? WHERE id='demo-page-file'").bind(Buffer.from('bad')).run();corrupt.close();
  await assert.rejects(()=>transferSqlite(path,target),/checksum/);
 }finally{try{source.close();}catch{}await target.close();await rm(dir,{recursive:true,force:true});}
});
test('failed PostgreSQL import rolls all destination data back',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const {transferSqlite}=await import('../src/storage/transfer.ts');
 const dir=await mkdtemp(join(tmpdir(),'lifeos-transfer-')),path=join(dir,'source.sqlite');
 const source=new LocalDatabase(path),target=await openTestDatabase('postgres');
 try{
  await makeWorkspace(source,{demo:false});source.close();await target.migrate();
  await target.exec("ALTER TABLE records ADD CONSTRAINT reject_fixture CHECK(kind<>'settings')");
  await assert.rejects(()=>transferSqlite(path,target),/constraint/);
  assert.equal(await target.prepare('SELECT count(*) n FROM meta').first('n'),0);
  assert.equal(await target.prepare('SELECT count(*) n FROM records').first('n'),0);
 }finally{try{source.close();}catch{}await target.close();await rm(dir,{recursive:true,force:true});}
});
