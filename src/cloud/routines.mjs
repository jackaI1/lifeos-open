import {lifeosDay} from '../../public/lifeos-day.js';
import {RecordPlan} from './plan.mjs';import {commitPlan} from './records.mjs';import {scheduleTick} from '../runtime/schedule.mjs';import {localDate,addDays} from '../domain/time.mjs';
const unpack=r=>({kind:r.kind,id:r.id,data:JSON.parse(r.data),version:r.version,createdAt:r.created_at,updatedAt:r.updated_at});
// Only current operational rows participate. Historical journals and source bodies never enter reminder evaluation.
export async function cloudRoutines(store,config,now=new Date().toISOString()){
 const preferences=(await store.get('settings','preferences'))?.data??{},timeZone=preferences.timezone??config.timeZone??'America/Toronto',date=lifeosDay(now,timeZone),from=addDays(date,-7),end=addDays(date,2),quarter=Math.floor(Date.parse(now)/900000),kinds=['settings','spiritual','task','calendar-event','ticket-spend','presence','training','push-subscription'];
 const rows=await store.db.batch([
  store.sql("SELECT * FROM records WHERE kind IN ('settings','training','push-subscription') OR kind='spiritual' AND json_extract(data,'$.date') BETWEEN ? AND ? OR kind='task' AND COALESCE(json_extract(data,'$.status'),'todo') NOT IN ('complete','archived') OR kind IN ('presence','ticket-spend') AND updated_at>=? OR kind='calendar-event' AND COALESCE(json_extract(data,'$.start.dateTime'),json_extract(data,'$.start.date'))>=? AND COALESCE(json_extract(data,'$.start.dateTime'),json_extract(data,'$.start.date'))<? LIMIT 701",addDays(date,-1),addDays(date,1),from,from,end),
  store.sql(`SELECT * FROM kind_revisions WHERE kind IN (${kinds.map(()=>'?').join(',')})`,...kinds),
  store.sql("SELECT * FROM meta WHERE key IN ('automationPaused','maintenancePaused',?) OR key LIKE ? LIMIT 501",'schedule:sources:'+quarter,'schedule:%'+date+'%'),
  store.sql("SELECT id,type,status,updated_at FROM jobs WHERE status='completed' AND updated_at>? ORDER BY updated_at DESC LIMIT 20",Date.parse(now)-86400000)
 ]);if(rows[0].results.length>700||rows[2].results.length>500)throw Error('Current reminder snapshot needs a smaller batch');
 const jobKeys=rows[3].results.map(r=>'schedule:job:'+r.id);if(jobKeys.length){const extra=await store.sql(`SELECT * FROM meta WHERE key IN (${jobKeys.map(()=>'?').join(',')})`,...jobKeys).all();rows[2].results.push(...extra.results);}
 const plan=new RecordPlan({records:rows[0].results.map(unpack),kinds,meta:Object.fromEntries(rows[2].results.map(r=>[r.key,JSON.parse(r.value)]))});
 plan.epochChecks=kinds.map(kind=>store.assertion('SELECT COALESCE((SELECT version FROM kind_revisions WHERE kind=?),0)=?',[kind,rows[1].results.find(r=>r.kind===kind)?.version??0]));
 plan.transaction=fn=>fn();plan.jobs=()=>rows[3].results.map(r=>({...r,updatedAt:new Date(r.updated_at).toISOString()}));
 const result=scheduleTick({store:plan,config,now});
 if(plan.queued.length||plan.metaChanges.length)await commitPlan(store,plan,{id:crypto.randomUUID(),fingerprint:{scheduledAt:now},result});
 return result;
}
