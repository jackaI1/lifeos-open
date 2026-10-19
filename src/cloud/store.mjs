import {recordDeadlineChange} from '../shared/deadline-changes.mjs';
import {jobPairPredicate} from './job-pairs.mjs';
import {AppError} from '../shared/errors.mjs';
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))).map(b=>b.toString(16).padStart(2,'0')).join('');
const unpack=r=>r&&({id:r.id,kind:r.kind,data:JSON.parse(r.data),version:r.version,createdAt:r.created_at,updatedAt:r.updated_at});
export class CloudStore {
 constructor(db){this.db=db;}
 sql(query,...args){return this.db.prepare(query).bind(...args);}
 async get(kind,id){return unpack(await this.sql('SELECT * FROM records WHERE kind=? AND id=?',kind,id).first());}
 async list(kind,{limit=500,offset=0}={}){if(!Number.isInteger(limit)||limit<1||limit>1000||!Number.isInteger(offset)||offset<0)throw new AppError('Invalid page');return (await this.sql('SELECT * FROM records WHERE kind=? ORDER BY updated_at DESC,id LIMIT ? OFFSET ?',kind,limit,offset).all()).results.map(unpack);}
 async meta(key){const r=await this.sql('SELECT value FROM meta WHERE key=?',key).first();return r?JSON.parse(r.value):null;}
 async mutation(id,fingerprint){const row=await this.sql('SELECT * FROM mutations WHERE id=?',id).first();if(!row)return null;if(row.fingerprint!==fingerprint)throw new AppError('Request ID was already used for a different action',409,'idempotency_conflict');return JSON.parse(row.result);}
 assertion(query,args=[]){return this.sql(`INSERT INTO assertions(id,ok) VALUES(?,(${query}))`,crypto.randomUUID(),...args);}
 /** Plans contain only server-validated operations. CHECK failures roll back the entire D1 batch. */
 async commit({id,fingerprint,reads=[],changes=[],jobs=[],result,preconditions=[],extra=[]}){
  if(changes.length>20||jobs.length>10||reads.length>50)throw new AppError('Action exceeds the bounded transaction size',413);
  const fp=await digest(JSON.stringify(fingerprint));const previous=await this.mutation(id,fp);if(previous)return previous;
  const statements=[...preconditions];const now=new Date().toISOString();
  for(const r of reads)statements.push(this.assertion('SELECT COALESCE((SELECT version FROM records WHERE kind=? AND id=?),0)=?',[r.kind,r.id,r.version]));
  for(const c of changes){
   const old=c.before??null,after=c.after;
   if(c.kind==='task')after.data=recordDeadlineChange(old?.data,after.data,now);
   if(after.kind!==c.kind||after.id!==c.id||after.version!==(old?.version??0)+1)throw new AppError('Invalid record revision');
   statements.push(this.assertion('SELECT COALESCE((SELECT version FROM records WHERE kind=? AND id=?),0)=?',[c.kind,c.id,old?.version??0]));
   statements.push(this.sql('INSERT INTO records VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,version=excluded.version,updated_at=excluded.updated_at',c.kind,c.id,JSON.stringify(after.data),after.version,after.createdAt,after.updatedAt));
   statements.push(this.sql('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)',c.auditId,c.kind,c.id,old?JSON.stringify(old):null,JSON.stringify(after),now,c.actor??'owner',c.undoOf??null));
  }
  for(const j of jobs)statements.push(this.sql("INSERT INTO jobs(id,type,payload,status,priority,available_at,created_at,updated_at,authority,dedupe_key,component) VALUES(?,?,?,'queued',?,?,?,?,?,?,?)",j.id,j.type,JSON.stringify(j.payload),j.priority??5,j.availableAt??Date.now(),Date.now(),Date.now(),j.authority,j.dedupeKey??null,j.component??'ai'));
  statements.push(...extra,this.sql('INSERT INTO mutations VALUES(?,?,?,?)',id,fp,JSON.stringify(result),now),this.sql('DELETE FROM assertions'));
  if(statements.length>45)throw new AppError('Action exceeds the free-plan transaction budget',413);
  try{await this.db.batch(statements);return result;}catch(error){if(/entry_deleted/.test(error.message))throw new AppError('This entry is in Deleted. Restore it in Settings before saving.',410,'entry_deleted');const existing=await this.mutation(id,fp);if(existing)return existing;if(/CHECK constraint|UNIQUE constraint/.test(error.message))throw new AppError('A record changed. Your draft has been kept for comparison.',409,'conflict');throw error;}
 }
 async claim(component,worker,{leaseMs=60000,types=[],allowedPairs=null}={}){
  if(!types.length||types.length>20)throw new AppError('Worker job types required');
  const pairs=allowedPairs===null?null:jobPairPredicate(allowedPairs);if(pairs&&allowedPairs.some(([type])=>!types.includes(type)))throw new AppError('Worker authority pair type is not permitted');
  const pairSql=pairs?' AND '+pairs.sql:'',pairArgs=pairs?.args??[];
  const now=Date.now(),handoffKey='worker-handoff:'+component;
  // The administrative handoff marker is checked inside both writes. A separate
  // preflight read could race with an already-authorized worker request.
  const results=await this.db.batch([
   this.sql(`UPDATE jobs SET status=CASE WHEN cancel_requested=1 THEN 'cancelled' WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,lease_owner=NULL,lease_until=NULL,error='Worker interrupted; request retained' WHERE component=? AND type!='cooking-help' AND status='running' AND lease_until<? AND NOT EXISTS (SELECT 1 FROM meta WHERE key=?)${pairSql}`,component,now,handoffKey,...pairArgs),
   this.sql(`UPDATE jobs SET status='running',lease_owner=?,lease_until=?,updated_at=?,attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE component=? AND type!='cooking-help' AND status='queued' AND cancel_requested=0 AND available_at<=? AND type IN (${types.map(()=>'?').join(',')})${pairSql} ORDER BY priority,created_at LIMIT 1) AND NOT EXISTS (SELECT 1 FROM meta WHERE key=?) RETURNING *`,worker,now+Math.min(leaseMs,120000),now,component,now,...types,...pairArgs,handoffKey)
  ]);return results[1].results[0]??null;
 }
 async heartbeat(name,details){const now=Date.now();await this.sql("INSERT INTO heartbeats(name,at,details) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET at=excluded.at,details=excluded.details WHERE heartbeats.at<=? OR COALESCE(json_extract(heartbeats.details,'$.status'),'')!=COALESCE(json_extract(excluded.details,'$.status'),'')",name,now,JSON.stringify(details),now-60000).run();}
 leaseAssertion(id,worker,now=Date.now()){return this.assertion("SELECT EXISTS(SELECT 1 FROM jobs WHERE id=? AND status='running' AND lease_owner=? AND lease_until>? AND cancel_requested=0)",[id,worker,now]);}
 async defer(id,worker,reason,until){return this.sql("UPDATE jobs SET status='queued',progress=?,available_at=?,attempts=MAX(0,attempts-1),lease_owner=NULL,lease_until=NULL WHERE id=? AND status='running' AND lease_owner=?",reason,until,id,worker).run();}
}
