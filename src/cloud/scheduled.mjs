import {runBudgetedBackground} from './database-budget.mjs';
import {backgroundEnabled,conservingWrites} from './d1-policy.mjs';
import {assembleFileSlice} from './file-assembly.mjs';
import {personalCalendarWrite} from './calendar-write.mjs';
import {cloudRoutines} from './routines.mjs';
import {CloudStore} from './store.mjs';import {googleFetch} from './google.mjs';import {hash} from '../shared/hash.mjs';import {localDate,weekday,addDays} from '../domain/time.mjs';
import {backupSlice} from './backup.mjs';
import {cloudNotification} from './push.mjs';
const nowRecord=(kind,id,data,before)=>({kind,id,data,version:(before?.version??0)+1,createdAt:before?.createdAt??new Date().toISOString(),updatedAt:new Date().toISOString()});
async function put(store,kind,id,data,mutation){const before=await store.get(kind,id);if(before&&JSON.stringify(before.data)===JSON.stringify(data))return;const after=nowRecord(kind,id,data,before);return store.commit({id:mutation??crypto.randomUUID(),fingerprint:{kind,id,data},changes:[{kind,id,before,after,auditId:crypto.randomUUID(),actor:'cloud-scheduler'}],result:{saved:true}});}
export async function calendarSlice({store,env,config,scope='full'}){
 const selected=Object.values(config.calendarIds??{});if(!selected.length||new Set(selected).size!==selected.length)throw Error('Configure distinct selected calendars');
 const near=scope==='near',cursorKey=near?'calendar-near-cursor':'calendar-cursor';
 const state=await store.meta(cursorKey)??{index:0},calendarId=selected[state.index%selected.length];
 const seenKey=near?'near:'+calendarId:calendarId,metaKey=(near?'calendar-near-state:':'calendar-state:')+hash(calendarId),cursor=await store.meta(metaKey)??{},date=localDate(Date.now(),'America/Toronto');
 cursor.window??={timeMin:addDays(date,near?-1:-7)+'T00:00:00Z',timeMax:addDays(date,near?4:120)+'T00:00:00Z'};cursor.runId??=crypto.randomUUID();
 if(cursor.reconcile){
  const missing=(await store.sql("SELECT * FROM records r WHERE kind='calendar-event' AND json_extract(data,'$.calendarId')=? AND COALESCE(json_extract(data,'$.sourceMissing'),0)=0 AND COALESCE(json_extract(data,'$.pendingProvider'),0)=0 AND COALESCE(json_extract(data,'$.start.dateTime'),json_extract(data,'$.start.date'))>=? AND COALESCE(json_extract(data,'$.start.dateTime'),json_extract(data,'$.start.date'))<? AND NOT EXISTS(SELECT 1 FROM calendar_seen s WHERE s.calendar_id=? AND s.record_id=r.id AND s.run_id=?) LIMIT 6",calendarId,cursor.window.timeMin.slice(0,10),cursor.window.timeMax.slice(0,10),seenKey,cursor.runId).all()).results;
  const changes=missing.map(r=>{const before={kind:r.kind,id:r.id,data:JSON.parse(r.data),version:r.version,createdAt:r.created_at,updatedAt:r.updated_at};return {kind:r.kind,id:r.id,before,after:nowRecord(r.kind,r.id,{...before.data,status:'cancelled',sourceMissing:true,sourceMissingReason:'Absent from a complete bounded calendar read; retained for review'},before),auditId:crypto.randomUUID(),actor:'calendar-sync'};});
  await store.commit({id:crypto.randomUUID(),fingerprint:{calendarId,reconcile:cursor.runId,ids:missing.map(r=>r.id)},changes,result:{reconciled:missing.length},extra:missing.length?[]:[store.sql('UPDATE meta SET value=? WHERE key=?','{}',metaKey),store.sql('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',cursorKey,JSON.stringify({index:(state.index+1)%selected.length}))]});
  if(!missing.length){const id='calendar-'+hash(calendarId).slice(0,16),before=await store.get('integration',id);await put(store,'integration',id,{...before?.data,status:'ready',calendarId,accessRole:cursor.accessRole,lastSuccess:new Date().toISOString(),lastCollectionAt:new Date().toISOString(),coverage:'Complete bounded calendar read',window:cursor.window});}
  return {calendarId,changed:missing.length,complete:!missing.length};
 }
 if(!cursor.page){
  const calendar=await (await googleFetch(env,`https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(calendarId)}`)).json();
  if(!['reader','writer','owner'].includes(calendar.accessRole)||calendarId===config.calendarIds.personal&&!['writer','owner'].includes(calendar.accessRole))throw Error('Selected calendar permissions changed');
  const query=new URLSearchParams({singleEvents:'true',showDeleted:'true',maxResults:'5',...cursor.window,...(cursor.pageToken?{pageToken:cursor.pageToken}:{})});
  cursor.page=await (await googleFetch(env,`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query}`)).json();cursor.accessRole=calendar.accessRole;
 }
 const changes=[];
 for(const event of cursor.page.items??[]){if(typeof event.id!=='string')throw Error('Provider event missing identifier');const id='calendar-'+hash([calendarId,event.id]).slice(0,40),before=await store.get('calendar-event',id),data={...before?.data,...event,calendarId,providerId:event.id,...(before?.data.pendingProvider?{pendingProvider:false}:{}),sourceMissing:false,source:{provider:'google-calendar',calendarId,eventId:event.id,updated:event.updated??null}};delete data.id;if(before&&JSON.stringify(before.data)===JSON.stringify(data))continue;changes.push({kind:'calendar-event',id,before,after:nowRecord('calendar-event',id,data,before),auditId:crypto.randomUUID(),actor:'calendar-sync'});}
 const next={window:cursor.window,runId:cursor.runId,accessRole:cursor.accessRole,...(cursor.page.nextPageToken?{pageToken:cursor.page.nextPageToken}:{reconcile:true})};
 const nextCalendar=state.index;
 await store.commit({id:crypto.randomUUID(),fingerprint:{calendarId,page:cursor.pageToken??null,at:Date.now()},changes,result:{applied:changes.length},extra:[...(cursor.page.items??[]).map(e=>store.sql('INSERT INTO calendar_seen VALUES(?,?,?) ON CONFLICT(calendar_id,record_id) DO UPDATE SET run_id=excluded.run_id',seenKey,'calendar-'+hash([calendarId,e.id]).slice(0,40),cursor.runId)),store.sql('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',metaKey,JSON.stringify(next)),store.sql('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',cursorKey,JSON.stringify({index:nextCalendar}))]});
 const integrationId='calendar-'+hash(calendarId).slice(0,16),previous=await store.get('integration',integrationId);await put(store,'integration',integrationId,{...previous?.data,status:'partial',calendarId,accessRole:cursor.accessRole,lastCollectionAt:new Date().toISOString(),coverage:'More pages or missing-event checks remain',window:cursor.window});
 return {calendarId,changed:changes.length,complete:false};
}
export async function scheduledTick(env){
 const store=new CloudStore(env.DB);
 if(!backgroundEnabled(env))return;
 const config={...JSON.parse(env.APP_CONFIG??'{}'),environment:env.ENVIRONMENT,origin:env.APP_ORIGIN,allowedEmail:env.ALLOWED_EMAIL,timeZone:'America/Toronto'},now=Date.now();
 if(await store.meta('migration-quiesced'))return;
 const conservation=await conservingWrites(store,now),backupsPaused=await store.meta('d1-backups-paused')===true;
 const owner='cloud-'+crypto.randomUUID();
 // A lease serializes provider state, scheduled batches and retries across overlapping cron deliveries.
 const lock=await store.sql("INSERT INTO meta VALUES('cloud-lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(json_extract(meta.value,'$.until') AS INTEGER)<? RETURNING key",JSON.stringify({owner,until:now+120000}),now).first();if(!lock)return;
 try{
  if(env.ENVIRONMENT==='production'&&env.AI_BUDGET){const budget=new CloudStore(env.AI_BUDGET),prefs=(await store.get('settings','preferences'))?.data??{},selected={studyReserveTimes:prefs.studyReserveTimes??[]};if(JSON.stringify(await budget.meta('school-reserve-preferences'))!==JSON.stringify(selected))await budget.sql("INSERT INTO meta VALUES('school-reserve-preferences',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(selected)).run();}
  await runBudgetedBackground(env,'cloud:routines',measured=>cloudRoutines(measured,{...config,backupsPaused,integrationsEnabled:config.integrationsEnabled&&!conservation}),{essential:true});
  // Backup jobs reclaim their own verified staging rows. Never scan every snapshot on a timer.
  const job=await store.claim('cloud',owner,{types:['personal-calendar-write','file-assemble','source-sync','backup','notification','notification-test'].filter(type=>!(backupsPaused&&type==='backup')&&!(conservation&&['backup','source-sync'].includes(type)))});
  if(job){const j={...job,payload:JSON.parse(job.payload)};try{let result;
   result=await runBudgetedBackground(env,'cloud:'+j.type,async measured=>{
   if(j.type==='personal-calendar-write')result=await personalCalendarWrite({store:measured,env,config,job:j});
   else if(j.type==='file-assemble')result=await assembleFileSlice({store:measured,env,config,job:j});
   else if(j.type==='source-sync')result=await calendarSlice({store:measured,env,config,scope:'near'});
   else if(j.type==='notification'||j.type==='notification-test')result=await cloudNotification({store:measured,env,config,job:j});
   else result=await backupSlice({store:measured,env,config,job:j});
   return result;},{essential:!['backup','source-sync'].includes(j.type)});
   if(result?.budgetPaused)await store.defer(j.id,owner,result.reason,result.resetAt);
   else if(result.complete===false)await store.defer(j.id,owner,'Continuing the next bounded cloud batch',Math.min(Date.now()+3600000,Math.max(Date.now()+60000,result.nextAttemptAt??0)));
   else await store.sql("UPDATE jobs SET status='completed',result=?,updated_at=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=? AND status='running'",JSON.stringify(result),Date.now(),j.id,owner).run();
  }catch(error){await store.sql("UPDATE jobs SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,error=?,available_at=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?",String(error.message).slice(0,300),Date.now()+Math.min(3600000,60000*2**j.attempts),j.id,owner).run();}}
  else if(config.integrationsEnabled&&!conservation&&Math.floor(now/60000)%5===0)await runBudgetedBackground(env,'cloud:calendar-sync',measured=>calendarSlice({store:measured,env,config,scope:Math.floor(now/60000)%30===0?'full':'near'}));
  await store.heartbeat('cloud-scheduler',{status:'ready',lastRun:new Date().toISOString()});
 }finally{await store.sql("DELETE FROM meta WHERE key='cloud-lease' AND json_extract(value,'$.owner')=?",owner).run();}
}
