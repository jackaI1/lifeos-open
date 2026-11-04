import {createHash} from 'node:crypto';
import {stat} from 'node:fs/promises';
import {LocalDatabase} from '../local/database.ts';
import {createBackup,verifyBackup} from '../local/backup.ts';
import type {WorkspaceBackup} from '../local/backup-data.ts';
import type {PostgresDatabase} from './postgres.ts';
const identifier=(value:string)=>{if(!/^[a-z_][a-z_0-9]*$/.test(value))throw Error('Invalid transfer identifier.');return '"'+value+'"';};
const canonical=(tables:WorkspaceBackup['tables'])=>JSON.stringify(Object.fromEntries(Object.entries(tables).sort(([a],[b])=>a.localeCompare(b)).map(([name,rows])=>[name,rows.map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))).sort()])));
/** Offline transfer: read-only source; empty target; verified all-or-nothing import. */
export async function transferSqlite(path:string,target:PostgresDatabase){
 if((await stat(path)).size>512*1024*1024)throw Error('SQLite source exceeds the 512 MiB transfer limit.');
 const source=new LocalDatabase(path,{readOnly:true});let snapshot:WorkspaceBackup;
 try{source.exec('BEGIN');snapshot=await createBackup(source);source.exec('ROLLBACK');}finally{source.close();}
 await verifyBackup(snapshot);
 await target.migrate();
 return target.transaction(async tx=>{
  const names=(await tx.tableNames()).filter(name=>!name.startsWith('_'));
  await tx.exec('LOCK TABLE '+names.map(identifier).join(',')+' IN ACCESS EXCLUSIVE MODE');
  for(const name of names)if(await tx.prepare('SELECT 1 FROM '+identifier(name)+' LIMIT 1').first())throw Error('PostgreSQL destination must be empty.');
  if(Object.keys(snapshot.tables).some(name=>!names.includes(name)))throw Error('SQLite source schema differs from this version.');
  let rows=0,bytes=0;
  // Revision triggers fire on records; replace their computed counts with source counts.
  for(const name of ['records',...Object.keys(snapshot.tables).filter(name=>name!=='records')]){
   if(name==='kind_revisions')await tx.exec('DELETE FROM kind_revisions');
   for(const row of snapshot.tables[name]??[]){
    const columns=Object.keys(row),values=columns.map(key=>{const value=row[key];if(value&&typeof value==='object'){const buffer=Buffer.from(value.lifeosBlob,'base64');bytes+=buffer.length;return buffer;}return value;});
    await tx.prepare('INSERT INTO '+identifier(name)+' ('+columns.map(identifier).join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').bind(...values).run();rows++;
   }
  }
  // Imported explicit IDs must not collide with subsequent native identity inserts.
  await tx.client!.query("SELECT setval(pg_get_serial_sequence('backup_rows','sequence'),COALESCE((SELECT max(sequence) FROM backup_rows),1),(SELECT count(*)>0 FROM backup_rows))");
  const expected=canonical(snapshot.tables),actual=canonical((await createBackup(tx)).tables);
  if(expected!==actual)throw Error('PostgreSQL transfer verification differs; import rolled back.');
  return {tables:Object.keys(snapshot.tables).length,rows,bytes,sha256:createHash('sha256').update(expected).digest('hex')};
 });
}
