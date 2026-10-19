import {DatabaseSync, backup} from 'node:sqlite';
import {randomUUID, createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export const hash = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex');
import {AppError} from '../shared/errors.mjs';
export {AppError};
const unpack = row => row && ({id:row.id,kind:row.kind,data:JSON.parse(row.data),version:row.version,createdAt:row.created_at,updatedAt:row.updated_at});
export class Store {
  constructor(path){
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);this.path=path;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,kind TEXT NOT NULL,record_id TEXT NOT NULL,before_json TEXT,after_json TEXT,created_at TEXT NOT NULL,actor TEXT NOT NULL,undo_of TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS mutations(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,csrf TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS nonces(id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,type TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,priority INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 3,available_at INTEGER NOT NULL,lease_until INTEGER,lease_owner TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,result TEXT,error TEXT,progress TEXT,cancel_requested INTEGER NOT NULL DEFAULT 0,authority TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS job_claim ON jobs(status,available_at,priority);
      CREATE TABLE IF NOT EXISTS chunks(session_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,sha256 TEXT NOT NULL,path TEXT NOT NULL,size INTEGER NOT NULL,mime_type TEXT NOT NULL,PRIMARY KEY(session_id,chunk_index));
      CREATE TABLE IF NOT EXISTS heartbeats(name TEXT PRIMARY KEY,at INTEGER NOT NULL,last_success INTEGER,details TEXT);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  get(kind,id){return unpack(this.db.prepare('SELECT * FROM records WHERE kind=? AND id=?').get(kind,id));}
  list(kind,{limit=1000,offset=0}={}){return this.db.prepare('SELECT * FROM records WHERE kind=? ORDER BY updated_at DESC,id LIMIT ? OFFSET ?').all(kind,limit,offset).map(unpack);}
  all(){const records={};for(const row of this.db.prepare('SELECT * FROM records ORDER BY updated_at DESC').all()){(records[row.kind]??=[]).push(unpack(row));}return records;}
  put(kind,id,data,version,{actor='owner',undoOf=null}={}){
    if(!this.db.isTransaction)return this.transaction(()=>this.put(kind,id,data,version,{actor,undoOf}));
    const old=this.get(kind,id);if((old?.version??0)!==version)throw new AppError('This record changed. Your writing has been kept for comparison.',409,'conflict',old);
    const now=new Date().toISOString();const item={id,kind,data,version:version+1,createdAt:old?.createdAt??now,updatedAt:now};
    this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,version=excluded.version,updated_at=excluded.updated_at').run(kind,id,JSON.stringify(data),item.version,item.createdAt,now);
    const auditId=randomUUID();this.db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(auditId,kind,id,old?JSON.stringify(old):null,JSON.stringify(item),now,actor,undoOf);
    return {...item,auditId};
  }
  upsertInternal(kind,id,data,actor='integration'){return this.put(kind,id,data,this.get(kind,id)?.version??0,{actor});}
  mutate(id,fingerprint,fn){return this.transaction(()=>{const old=this.db.prepare('SELECT * FROM mutations WHERE id=?').get(id);if(old){if(old.fingerprint!==hash(fingerprint))throw new AppError('This request ID was already used for a different action.',409,'idempotency_conflict');return JSON.parse(old.result);}const result=fn();this.db.prepare('INSERT INTO mutations VALUES(?,?,?,?)').run(id,hash(fingerprint),JSON.stringify(result),new Date().toISOString());return result;});}
  undo(auditId){const row=this.db.prepare('SELECT * FROM audit WHERE id=?').get(auditId);if(!row)throw new AppError('Change not found',404);if(this.db.prepare('SELECT id FROM audit WHERE undo_of=?').get(auditId))throw new AppError('This change was already undone',409);const after=JSON.parse(row.after_json),current=this.get(row.kind,row.record_id);if(current?.version!==after.version)throw new AppError('A later change exists. Review it before undoing.',409,'conflict',current);const before=row.before_json?JSON.parse(row.before_json):null;return this.put(row.kind,row.record_id,before?.data??{...current.data,archived:true,undone:true},current.version,{actor:'owner-undo',undoOf:auditId});}
  enqueue(type,payload,{priority=5,authority='owner',maxAttempts=3}={}){const id=randomUUID(),now=Date.now();this.db.prepare('INSERT INTO jobs(id,type,payload,status,priority,max_attempts,available_at,created_at,updated_at,authority) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,type,JSON.stringify(payload),'queued',priority,maxAttempts,now,now,now,authority);return this.job(id);}
  job(id){const r=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);if(!r)return null;return {id:r.id,type:r.type,payload:JSON.parse(r.payload),status:r.status,attempts:r.attempts,maxAttempts:r.max_attempts,createdAt:new Date(r.created_at).toISOString(),updatedAt:new Date(r.updated_at).toISOString(),result:r.result?JSON.parse(r.result):null,error:r.error,progress:r.progress,authority:r.authority,cancelRequested:!!r.cancel_requested};}
  jobs(limit=50){return this.db.prepare('SELECT id FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit).map(r=>this.job(r.id));}
  claim(worker,{types,leaseMs=60000}={}){return this.transaction(()=>{const now=Date.now();this.db.prepare("UPDATE jobs SET status=CASE WHEN cancel_requested=1 THEN 'cancelled' WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END, error='Worker interrupted; request retained',lease_owner=NULL,lease_until=NULL WHERE status='running' AND lease_until<?").run(now);const placeholders=types.map(()=>'?').join(',');const row=this.db.prepare(`SELECT id FROM jobs WHERE status='queued' AND cancel_requested=0 AND available_at<=? AND type IN (${placeholders}) ORDER BY (priority - MIN(5, (? - created_at)/300000)) ASC,created_at ASC LIMIT 1`).get(now,...types,now);if(!row)return null;this.db.prepare("UPDATE jobs SET status='running',lease_owner=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=?").run(worker,now+leaseMs,now,row.id);return this.job(row.id);});}
  lease(id,worker,progress){return this.db.prepare("UPDATE jobs SET lease_until=?,updated_at=?,progress=? WHERE id=? AND lease_owner=? AND status='running'").run(Date.now()+60000,Date.now(),progress,id,worker).changes===1;}
  finish(id,worker,result){return this.db.prepare("UPDATE jobs SET status=CASE WHEN cancel_requested=1 THEN 'cancelled' ELSE 'completed' END,result=?,updated_at=?,error=NULL,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=? AND status='running'").run(JSON.stringify(result),Date.now(),id,worker).changes===1;}
  fail(id,worker,error,{needsInput=false,usageLimited=false}={}){const job=this.job(id);const status=job.cancelRequested?'cancelled':needsInput?'needs-input':usageLimited?'usage-limited':job.attempts>=job.maxAttempts?'failed':'queued';this.db.prepare("UPDATE jobs SET status=?,error=?,available_at=?,updated_at=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?").run(status,String(error).slice(0,500),Date.now()+Math.min(3600000,30000*2**job.attempts),Date.now(),id,worker);}
  cancel(id){const r=this.db.prepare("UPDATE jobs SET cancel_requested=1,status=CASE WHEN status IN ('queued','needs-input','usage-limited') THEN 'cancelled' ELSE status END,updated_at=? WHERE id=? AND status NOT IN ('completed','failed','cancelled')").run(Date.now(),id);return r.changes>0;}
  heartbeat(name,details={},success=false){this.db.prepare('INSERT INTO heartbeats VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET at=excluded.at,last_success=COALESCE(excluded.last_success,heartbeats.last_success),details=excluded.details').run(name,Date.now(),success?Date.now():null,JSON.stringify(details));}
  meta(key,value){if(value!==undefined)this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));const row=this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);return row?JSON.parse(row.value):null;}
  async backup(destination){await backup(this.db,destination);const check=new DatabaseSync(destination,{readOnly:true});try{const row=check.prepare('PRAGMA integrity_check').get();if(row.integrity_check!=='ok')throw new Error('Backup integrity check failed');return {integrity:'ok',records:check.prepare('SELECT count(*) AS n FROM records').get().n};}finally{check.close();}}
  close(){this.db.close();}
}
