import {readFile,mkdir,open,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {LocalDatabase} from './database.ts';
import {LocalObjects} from './objects.ts';
import {createBackup,tableNames} from './backup-data.ts';
import type {WorkspaceBackup} from './backup-data.ts';
export {createBackup} from './backup-data.ts';
export type {WorkspaceBackup} from './backup-data.ts';
const excluded=new Set(['sessions','oauth_logins','worker_credentials','local_snapshots']);
const identifier=(v:string)=>{if(!/^[a-z_][a-z_0-9]*$/.test(v))throw Error('Invalid backup table or column.');return '"'+v+'"';};
const decode=(value:any)=>{if(value&&typeof value==='object'){if(Object.keys(value).length!==1||typeof value.lifeosBlob!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.lifeosBlob))throw Error('Invalid backup binary field.');return Buffer.from(value.lifeosBlob,'base64');}if(value!==null&&!['string','number'].includes(typeof value))throw Error('Invalid backup field.');return value;};
async function initialise(db:LocalDatabase){db.exec(await readFile('src/cloud/schema.sql','utf8'));new LocalObjects(db,'');}
export async function restoreBackup(db:LocalDatabase,backup:WorkspaceBackup){
 if(backup?.format!=='lifeos-local-backup-v1'||!backup.tables||typeof backup.tables!=='object'||!Number.isFinite(Date.parse(backup.createdAt)))throw Error('Unsupported or incomplete LifeOS backup.');
 const allowed=await tableNames(db),names=Object.keys(backup.tables);if(names.some(n=>!allowed.includes(n))||!names.includes('records')||!names.includes('local_objects'))throw Error('Backup schema does not match this LifeOS version.');
 // Insert records first; their revision triggers run against empty auxiliary tables.
 const ordered=['records',...names.filter(n=>n!=='records')];db.exec('BEGIN IMMEDIATE');
 try{
  for(const name of allowed)db.exec('DELETE FROM '+identifier(name));
  for(const name of ordered){const columns=(await db.prepare('PRAGMA table_info('+identifier(name)+')').all()).results.map(r=>String(r.name));const rows=backup.tables[name];if(!Array.isArray(rows))throw Error('Invalid backup table.');
   for(const row of rows){if(!row||Object.keys(row).length!==columns.length||Object.keys(row).some(k=>!columns.includes(k)))throw Error('Invalid backup row schema.');const query='INSERT OR REPLACE INTO '+identifier(name)+' ('+columns.map(identifier).join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')';await db.prepare(query).bind(...columns.map(c=>decode(row[c]))).run();}
  }db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
const canonical=(snapshot:WorkspaceBackup)=>JSON.stringify(Object.fromEntries(Object.entries(snapshot.tables).sort(([a],[b])=>a.localeCompare(b)).map(([name,rows])=>[name,rows.map(r=>JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a],[b])=>a.localeCompare(b))))).sort()])));
async function verifyFiles(db:LocalDatabase){
 if(await db.prepare('PRAGMA integrity_check').first('integrity_check')!=='ok')throw Error('Restored SQLite integrity check failed.');
 const objects=new Map<string,{bytes:Buffer;meta:any}>();
 for(const row of (await db.prepare('SELECT * FROM local_objects').all()).results){const bytes=Buffer.from(row.content),meta=JSON.parse(row.metadata);if(String(bytes.length)!==meta.size||createHash('md5').update(bytes).digest('hex')!==meta.md5Checksum)throw Error('Restored local object checksum differs.');objects.set(row.id,{bytes,meta});}
 for(const table of ['private_objects','chunks'])for(const row of (await db.prepare('SELECT * FROM '+identifier(table)).all()).results){if(table==='private_objects'&&!row.verified)continue;const object=objects.get(row.drive_id);if(!object||object.bytes.length!==row.size||createHash('sha256').update(object.bytes).digest('hex')!==row.sha256)throw Error('Restored file reference or checksum differs.');}
}
export async function verifyBackup(snapshot:WorkspaceBackup){const db=new LocalDatabase(':memory:');try{await initialise(db);await restoreBackup(db,snapshot);await verifyFiles(db);if(canonical(snapshot)!==canonical(await createBackup(db)))throw Error('Backup restore verification differs.');return true;}finally{db.close();}}
export async function saveVerifiedBackup(db:LocalDatabase){const snapshot=await createBackup(db);await verifyBackup(snapshot);const id=randomUUID(),content=JSON.stringify(snapshot);db.exec('CREATE TABLE IF NOT EXISTS local_snapshots(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,content TEXT NOT NULL,sha256 TEXT NOT NULL)');await db.prepare('INSERT INTO local_snapshots VALUES(?,?,?,?)').bind(id,snapshot.createdAt,content,createHash('sha256').update(content).digest('hex')).run();return {id,verified:true};}
export async function restoreBackupFile(source:string,destination:string){const bytes=await readFile(source);if(bytes.length>512*1024*1024)throw Error('Backup exceeds the restore size limit.');const snapshot=JSON.parse(bytes.toString()) as WorkspaceBackup;await verifyBackup(snapshot);await mkdir(dirname(destination),{recursive:true,mode:0o700});const handle=await open(destination,'wx',0o600);await handle.close();let db:LocalDatabase|undefined;try{db=new LocalDatabase(destination);await initialise(db);await restoreBackup(db,snapshot);db.close();db=undefined;}catch(error){db?.close();await rm(destination,{force:true});await rm(destination+'-wal',{force:true});await rm(destination+'-shm',{force:true});throw error;}}
