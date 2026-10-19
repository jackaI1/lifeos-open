import {AppError} from '../shared/errors.mjs';
import {captureCookingHelpIntent,createCookingHelpRequest,validateCookingHelpResult} from '../shared/cooking-help-contract.mjs';
import {digest} from './store.mjs';
import {conservingWrites,backgroundEnabled} from './d1-policy.mjs';
import {aiWorkerTypes,ownerAIPairs,jobPairPredicate} from './job-pairs.mjs';

const requestKind='cooking-help-request',invocationKind='cooking-help-invocation',resultKind='cooking-help-result';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied=()=>new AppError('Local cooking help is not available in this workspace.',403,'cooking_help_denied');
const changed=()=>new AppError('This original cooking request cannot start again. It has been kept.',409,'cooking_help_changed');
function beta(env){if(env?.ENVIRONMENT!=='beta')throw denied();}
function fields(body,keys){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==keys.length||keys.some(k=>!Object.hasOwn(body,k)))throw new AppError('Invalid cooking request');}
const pair=row=>row?.component==='ai'&&row.type==='cooking-help'&&row.authority==='owner-cooking-help';
const freshLease=(row,owner,now)=>row?.status==='running'&&row.lease_owner===owner&&row.lease_until>now&&!row.cancel_requested;
async function capable(store,env,credential=null){
 if(env.LOCAL_MOCK_SERVICES)return true;
 if(env.COOKING_LOCAL_HELP_ENABLED!=='true')return false;
 const cap=await store.meta('cooking-help-capability');
 if(cap?.protocolVersion!==1||cap.model!=='qwen3.8:27b-q4_K_M'||!Number.isFinite(cap.at)||cap.at>Date.now()||Date.now()-cap.at>90000||credential&&cap.credential!==credential)return false;
 return !!await store.sql("SELECT token_hash FROM worker_credentials WHERE token_hash=? AND component='ai' AND revoked=0 AND expires_at>?",cap.credential,Date.now()).first();
}
async function captured(input){
 let intent,body;try{intent=captureCookingHelpIntent(input);body=createCookingHelpRequest(intent);}catch(error){throw new AppError(error.message,error.code==='cooking_help_limit'?413:400,error.code);}
 return{intent,body,intentHash:await digest(JSON.stringify(intent)),bodyHash:await digest(JSON.stringify(body))};
}
async function exactSource(store,intent){const source=await store.get('meal',intent.source.id);if(!source||source.version!==intent.source.version||source.data.archived||source.data.recipe!==intent.source.recipe||await store.sql("SELECT id FROM retired_records WHERE kind='meal' AND id=?",intent.source.id).first())throw new AppError('The saved recipe changed. Your original question has been kept.',409,'cooking_help_source_changed');return source;}
function record(kind,id,data){const now=new Date().toISOString();return{kind,id,data,version:1,createdAt:now,updatedAt:now};}
const change=item=>({kind:item.kind,id:item.id,before:null,after:item,auditId:crypto.randomUUID(),actor:'owner-local-cooking-help'});
const fence=store=>store.assertion('SELECT NOT EXISTS(SELECT 1 FROM meta WHERE key=?)',['worker-handoff:ai']);
const noMarker=(store,id)=>store.assertion('SELECT NOT EXISTS(SELECT 1 FROM records WHERE kind=? AND id=?)',[invocationKind,id]);
// D1 evaluates these inside the write transaction, after asynchronous reads.
const sqlNow="CAST(ROUND((julianday('now')-2440587.5)*86400000) AS INTEGER)";
const credentialAssertion=(store,credential)=>store.assertion(`SELECT EXISTS(SELECT 1 FROM worker_credentials WHERE token_hash=? AND component='ai' AND revoked=0 AND expires_at>${sqlNow})`,[credential]);
const capabilityAssertion=(store,credential=null)=>store.assertion(`SELECT EXISTS(SELECT 1 FROM meta m JOIN worker_credentials c ON c.token_hash=json_extract(m.value,'$.credential') WHERE m.key='cooking-help-capability' AND json_extract(m.value,'$.protocolVersion')=1 AND json_extract(m.value,'$.model')='qwen3.8:27b-q4_K_M' AND json_extract(m.value,'$.at')<=${sqlNow} AND json_extract(m.value,'$.at')>${sqlNow}-90000 AND c.component='ai' AND c.revoked=0 AND c.expires_at>${sqlNow} AND (? IS NULL OR c.token_hash=?))`,[credential,credential]);
const sourceAssertion=(store,intent)=>store.assertion("SELECT EXISTS(SELECT 1 FROM records r WHERE r.kind='meal' AND r.id=? AND r.version=? AND json_extract(r.data,'$.recipe')=? AND COALESCE(json_extract(r.data,'$.archived'),0)=0 AND NOT EXISTS(SELECT 1 FROM retired_records d WHERE d.kind='meal' AND d.id=r.id))",[intent.source.id,intent.source.version,intent.source.recipe]);
const conservationAssertion=store=>store.assertion(`SELECT NOT EXISTS(SELECT 1 FROM meta WHERE key=? AND json_type(value) IN ('integer','real') AND json_extract(value,'$')>${sqlNow})`,['d1-conservation-until']);
const pairAssertion=(store,id)=>store.assertion("SELECT EXISTS(SELECT 1 FROM jobs WHERE id=? AND component='ai' AND type='cooking-help' AND authority='owner-cooking-help')",[id]);
const leaseAssertion=(store,id,owner)=>store.assertion(`SELECT EXISTS(SELECT 1 FROM jobs WHERE id=? AND component='ai' AND type='cooking-help' AND authority='owner-cooking-help' AND status='running' AND lease_owner=? AND lease_until>${sqlNow} AND cancel_requested=0)`,[id,owner]);
async function guardedBatch(store,statements){try{return await store.db.batch(statements);}catch(error){if(/CHECK constraint|UNIQUE constraint/.test(error.message))throw changed();throw error;}}
function receipt(saved){return{requestId:saved.intent.requestId,intentHash:saved.intentHash,bodyHash:saved.bodyHash,deadline:saved.deadline,status:'queued'};}
async function original(store,id){const saved=await store.get(requestKind,id);if(!saved||saved.version!==1)throw new AppError('Cooking question unavailable',404);const c=await captured(saved.data.intent);if(c.intentHash!==saved.data.intentHash||c.bodyHash!==saved.data.bodyHash||!Number.isSafeInteger(saved.data.deadline))throw changed();return{saved,...c};}

export async function cookingHelpRoute({req,path,body,store,env,session}){
 beta(env);
 if(path==='/api/cooking-help'&&req.method==='POST'){
  const c=await captured(body);if(c.intent.owner!==session.email)throw denied();
  const mutation='cooking-help:create:'+c.intent.requestId,fingerprint={intentHash:c.intentHash},previous=await store.mutation(mutation,await digest(JSON.stringify(fingerprint)));if(previous)return Response.json(previous);
  if(!await capable(store,env))throw new AppError('Local cooking help is unavailable. Keep your question and try later.',503,'cooking_help_unavailable');
  const source=await exactSource(store,c.intent),now=Date.now(),data={contractVersion:1,intent:c.intent,intentHash:c.intentHash,bodyHash:c.bodyHash,createdAt:now,deadline:now+120000},item=record(requestKind,c.intent.requestId,data),result=receipt(data);
  const payload={requestId:c.intent.requestId,intentHash:c.intentHash,bodyHash:c.bodyHash};
  const committed=await store.commit({id:mutation,fingerprint,reads:[{kind:'meal',id:source.id,version:source.version}],changes:[change(item)],preconditions:[...(env.LOCAL_MOCK_SERVICES?[]:[capabilityAssertion(store)]),sourceAssertion(store,c.intent)],extra:[store.sql("INSERT INTO jobs(id,type,payload,status,priority,max_attempts,available_at,created_at,updated_at,authority,component) VALUES(?,'cooking-help',?,'queued',7,1,?,?,?,'owner-cooking-help','ai')",item.id,JSON.stringify(payload),now,now,now)],result});return Response.json(committed);
 }
 const match=path.match(/^\/api\/cooking-help\/([0-9a-f-]+)(\/cancel)?$/i);if(!match||!uuid.test(match[1]))throw new AppError('Cooking question unavailable',404);
 const o=await original(store,match[1]);if(o.intent.owner!==session.email)throw denied();
 if(match[2]&&req.method==='POST'){
  fields(body,[]);await guardedBatch(store,[pairAssertion(store,match[1]),store.sql("UPDATE jobs SET cancel_requested=1,status=CASE WHEN EXISTS(SELECT 1 FROM records WHERE kind=? AND id=jobs.id) THEN 'uncertain' ELSE 'cancelled' END,updated_at=? WHERE id=? AND component='ai' AND type='cooking-help' AND authority='owner-cooking-help' AND status NOT IN ('completed','failed','cancelled')",invocationKind,Date.now(),match[1]),store.sql('DELETE FROM assertions')]);return Response.json({cancelled:true,requestId:match[1]});
 }
 if(match[2]||req.method!=='GET')throw new AppError('Method not allowed',405);
 const job=await store.sql('SELECT * FROM jobs WHERE id=?',match[1]).first(),terminal=await store.get(resultKind,match[1]),marker=await store.get(invocationKind,match[1]);let sourceChanged=false;try{await exactSource(store,o.intent);}catch{sourceChanged=true;}
 const status=terminal?(terminal.data.late?'late-result':'completed'):marker&&(!freshLease(job,job?.lease_owner,Date.now())||job?.status==='uncertain')?'uncertain':!marker&&!job?.cancel_requested&&job?.status==='queued'&&o.saved.data.deadline<=Date.now()?'expired':job?.status??'unavailable';
 return Response.json({...receipt(o.saved.data),status,sourceChanged,cancelled:!!job?.cancel_requested,...(terminal?{result:terminal.data.result,late:terminal.data.late}:{}),serverNow:Date.now()});
}

export async function cookingHelpWorkerRoute({path,body,store,env,identity}){
 beta(env);if(identity.component!=='ai')throw denied();
 const operation=path.slice('/api/worker/cooking-'.length),now=Date.now();
 if(operation==='heartbeat'){
  fields(body,['protocolVersion']);if(body.protocolVersion!==1||env.COOKING_LOCAL_HELP_ENABLED!=='true')throw denied();
  await store.sql('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','cooking-help-capability',JSON.stringify({protocolVersion:1,model:'qwen3.8:27b-q4_K_M',credential:identity.id,at:now})).run();return Response.json({available:true,serverNow:now});
 }
 if(operation==='claim'){
  fields(body,['protocolVersion']);if(body.protocolVersion!==1)throw denied();if(!await capable(store,env,identity.id)||await conservingWrites(store))return Response.json({job:null});
  const token=crypto.randomUUID(),owner=identity.id+':'+token,allowed=backgroundEnabled(env)?null:jobPairPredicate(ownerAIPairs),genericFilter=allowed?' AND '+allowed.sql.replace(/\b(type|authority)\b/g,'g.$1'):'',genericArgs=allowed?.args??[];
  const rows=await guardedBatch(store,[
   capabilityAssertion(store,identity.id),conservationAssertion(store),
   store.sql("UPDATE jobs SET status=CASE WHEN cancel_requested=1 THEN 'cancelled' WHEN json_extract((SELECT data FROM records WHERE kind=? AND id=jobs.id),'$.deadline')<=? THEN 'expired' ELSE 'queued' END,lease_owner=NULL,lease_until=NULL WHERE component='ai' AND type='cooking-help' AND authority='owner-cooking-help' AND status='running' AND lease_until<=? AND NOT EXISTS(SELECT 1 FROM records WHERE kind=? AND id=jobs.id) AND NOT EXISTS(SELECT 1 FROM meta WHERE key='worker-handoff:ai')",requestKind,now,now,invocationKind),
   store.sql(`UPDATE jobs SET status='running',lease_owner=?,lease_until=?,updated_at=? WHERE id=(SELECT j.id FROM jobs j JOIN records r ON r.kind=? AND r.id=j.id WHERE j.component='ai' AND j.type='cooking-help' AND j.authority='owner-cooking-help' AND j.status='queued' AND j.cancel_requested=0 AND j.available_at<=? AND json_extract(r.data,'$.deadline')>? AND NOT EXISTS(SELECT 1 FROM records i WHERE i.kind=? AND i.id=j.id) AND NOT EXISTS(SELECT 1 FROM jobs g WHERE g.component='ai' AND g.type IN (${aiWorkerTypes.map(()=>'?').join(',')})${genericFilter} AND g.cancel_requested=0 AND g.available_at<=? AND (g.status='queued' OR g.status='running' AND g.lease_until<? AND g.attempts<g.max_attempts) AND (g.priority<j.priority OR g.priority=j.priority AND g.created_at<j.created_at)) ORDER BY j.created_at LIMIT 1) AND NOT EXISTS(SELECT 1 FROM meta WHERE key='worker-handoff:ai') RETURNING *`,owner,now+60000,now,requestKind,now,now,invocationKind,...aiWorkerTypes,...genericArgs,now,now),
   store.sql('DELETE FROM assertions')
  ]),row=rows[3].results[0];if(!row)return Response.json({job:null});
  let o;try{o=await original(store,row.id);await exactSource(store,o.intent);}catch(error){await store.sql(`UPDATE jobs SET status='needs-input',lease_owner=NULL,lease_until=NULL WHERE id=? AND component='ai' AND type='cooking-help' AND authority='owner-cooking-help' AND status='running' AND lease_owner=? AND lease_until>${sqlNow} AND cancel_requested=0 AND NOT EXISTS(SELECT 1 FROM records WHERE kind='cooking-help-invocation' AND id=jobs.id)`,row.id,owner).run();throw error;}
  return Response.json({job:{id:row.id,type:row.type,authority:row.authority},input:{intent:o.intent,intentHash:o.intentHash,bodyHash:o.bodyHash,deadline:o.saved.data.deadline,serverNow:Date.now()},claimToken:token});
 }
 fields(body,operation==='result'?['jobId','claimToken','intentHash','bodyHash','result']:operation==='fail'?['jobId','claimToken','intentHash','bodyHash','reason']:['jobId','claimToken','intentHash','bodyHash']);
 if(!uuid.test(body.jobId)||!uuid.test(body.claimToken))throw changed();const owner=identity.id+':'+body.claimToken,row=await store.sql('SELECT * FROM jobs WHERE id=?',body.jobId).first(),o=await original(store,body.jobId);
 if(!pair(row)||body.intentHash!==o.intentHash||body.bodyHash!==o.bodyHash)throw changed();
 const marker=await store.get(invocationKind,row.id);
 if(operation==='result'){
  if(!marker||marker.version!==1||marker.data.credential!==identity.id||marker.data.claimToken!==body.claimToken||marker.data.intentHash!==o.intentHash||marker.data.bodyHash!==o.bodyHash)throw changed();
  let result;try{result=validateCookingHelpResult(body.result,o.intent);}catch{throw new AppError('The cooking draft could not be verified. The original request is retained.',400,'cooking_help_result_invalid');}
  const fingerprint={invocationId:marker.data.invocationId,result},mutation='cooking-help:result:'+row.id,previous=await store.mutation(mutation,await digest(JSON.stringify(fingerprint)));if(previous)return Response.json(previous);
  let sourceChanged=false;try{await exactSource(store,o.intent);}catch{sourceChanged=true;}
  const late=!freshLease(row,owner,now)||sourceChanged,item=record(resultKind,row.id,{invocationId:marker.data.invocationId,result,late,sourceChanged,cancelled:!!row.cancel_requested,receivedAt:now}),answer={retained:true,late,requestId:row.id};
  const committed=await store.commit({id:mutation,fingerprint,reads:[{kind:requestKind,id:row.id,version:1},{kind:invocationKind,id:row.id,version:1}],changes:[change(item)],preconditions:[credentialAssertion(store,identity.id),pairAssertion(store,row.id),...(!late?[leaseAssertion(store,row.id,owner),sourceAssertion(store,o.intent)]:[])],extra:[store.sql("UPDATE jobs SET status=?,result=?,updated_at=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND component='ai' AND type='cooking-help' AND authority='owner-cooking-help'",late?'uncertain':'completed',JSON.stringify({requestId:row.id,resultRetained:true,late}),now,row.id)],result:answer});return Response.json(committed);
 }
 if(!freshLease(row,owner,now))throw changed();
 if(operation==='lease'){
  const rows=await store.sql("UPDATE jobs SET lease_until=?,updated_at=? WHERE id=? AND component='ai' AND type='cooking-help' AND authority='owner-cooking-help' AND lease_owner=? AND status='running' AND lease_until>? AND cancel_requested=0 RETURNING id",now+60000,now,row.id,owner,now).all();if(rows.results.length!==1)throw changed();return Response.json({active:true,serverNow:now,deadline:o.saved.data.deadline});
 }
 if(operation==='start'){
  if(marker||o.saved.data.deadline<=now||!await capable(store,env,identity.id))throw changed();const source=await exactSource(store,o.intent),invocationId=crypto.randomUUID(),item=record(invocationKind,row.id,{invocationId,credential:identity.id,claimToken:body.claimToken,intentHash:o.intentHash,bodyHash:o.bodyHash,model:'qwen3.8:27b-q4_K_M',markedAt:now});
  const committed=await store.commit({id:'cooking-help:start:'+row.id+':'+invocationId,fingerprint:{invocationId},reads:[{kind:requestKind,id:row.id,version:1},{kind:'meal',id:source.id,version:source.version}],changes:[change(item)],preconditions:[fence(store),noMarker(store,row.id),capabilityAssertion(store,identity.id),sourceAssertion(store,o.intent),leaseAssertion(store,row.id,owner),store.assertion(`SELECT CAST(json_extract(data,'$.deadline') AS INTEGER)>${sqlNow} FROM records WHERE kind=? AND id=?`,[requestKind,row.id])],extra:[store.sql("UPDATE jobs SET attempts=1,progress='Local cooking help may have started' WHERE id=? AND lease_owner=?",row.id,owner)],result:{invocationGranted:true,invocationId,jobId:row.id,intentHash:o.intentHash,bodyHash:o.bodyHash}});return Response.json(committed);
 }
 if(operation==='defer'||operation==='fail'){
  if(operation==='fail'&&!['local-busy','local-stopped','local-uncertain','local-rejected'].includes(body.reason))throw new AppError('Invalid cooking outcome');
  const rows=await guardedBatch(store,[leaseAssertion(store,row.id,owner),store.sql(`UPDATE jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM records WHERE kind=? AND id=jobs.id) THEN 'uncertain' WHEN ?<=${sqlNow} THEN 'expired' ELSE ? END,available_at=?,lease_owner=NULL,lease_until=NULL,updated_at=?,error=CASE WHEN EXISTS(SELECT 1 FROM records WHERE kind=? AND id=jobs.id) THEN 'Local completion is uncertain; the original will not be regenerated' ELSE ? END WHERE id=? AND lease_owner=? RETURNING status`,invocationKind,o.saved.data.deadline,operation==='defer'?'queued':'failed',Math.min(now+1000,o.saved.data.deadline),now,invocationKind,operation==='defer'?'Waiting for local processing':body.reason,row.id,owner),store.sql('DELETE FROM assertions')]);return Response.json({retained:true,status:rows[1].results[0].status,deadline:o.saved.data.deadline});
 }
 throw new AppError('Cooking operation unavailable',404);
}
