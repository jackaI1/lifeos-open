import {createHash} from 'node:crypto';
import {createGoogleAdapter} from './google.mjs';
import {createLocalBackup,archiveBackup} from './backups.mjs';
import {addDays,localDate,validDate} from '../domain/time.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const error=(message,code='integration_blocked')=>Object.assign(new Error(message),{code});
const check=signal=>{if(signal?.aborted)throw error('Processing stopped. Saved files remain preserved.','cancelled');};
const put=(store,kind,id,data)=>{const old=store.get(kind,id);return JSON.stringify(old?.data)===JSON.stringify(data)?old:store.put(kind,id,data,old?.version??0,{actor:'integration'});};
export function currentTermWindow({now=new Date().toISOString(),timeZone='UTC',window}={}){
 const startDate=window?.startDate??localDate(now,timeZone),endDate=window?.endDate??addDays(startDate,90);
 if(!validDate(startDate)||!validDate(endDate)||endDate<=startDate||Date.parse(endDate)-Date.parse(startDate)>366*86400000)throw error('Configure a bounded calendar window','configuration_missing');
 return {startDate,endDate,timeMin:startDate+'T00:00:00Z',timeMax:endDate+'T00:00:00Z'};
}
export function importCalendarSnapshot({store,config,calendars,window}){
 const allowed=Object.values(config.calendarIds??{}).filter(Boolean);
 if(!allowed.length||new Set(allowed).size!==allowed.length||!Array.isArray(calendars)||calendars.length!==allowed.length||new Set(calendars.map(c=>c.calendarId)).size!==allowed.length)throw error('Every selected calendar must be verified together','calendar_contract');
 for(const calendar of calendars)if(!allowed.includes(calendar.calendarId)||calendar.complete!==true||!['reader','writer','owner'].includes(calendar.accessRole)||!Array.isArray(calendar.events))throw error('The selected calendar read is incomplete or unauthorized','calendar_contract');
 let count=0,suppressed=0;
 store.transaction(()=>{for(const calendar of calendars){const seen=new Set();for(const event of calendar.events){if(typeof event.id!=='string'||!event.id)throw error('Calendar event has no stable identifier','calendar_contract');const id='calendar-'+hash([calendar.calendarId,event.id]).slice(0,40);seen.add(id);const data={...store.get('calendar-event',id)?.data,...event,calendarId:calendar.calendarId,providerId:event.id,sourceMissing:false,source:{provider:'google-calendar',calendarId:calendar.calendarId,eventId:event.id,updated:event.updated??null}};delete data.id;put(store,'calendar-event',id,data);count++;}
 for(const prior of store.list('calendar-event',{limit:100000})){const start=prior.data.start?.dateTime??prior.data.start?.date??prior.data.start;if(prior.data.calendarId!==calendar.calendarId||seen.has(prior.id)||!start||prior.data.pendingProvider)continue;if(Date.parse(start)>=Date.parse(window.timeMin)&&Date.parse(start)<Date.parse(window.timeMax)){put(store,'calendar-event',prior.id,{...prior.data,status:'cancelled',sourceMissing:true});suppressed++;}}
 }});return {calendars:calendars.length,events:count,suppressedMissing:suppressed,window};
}
export function createIntegrationRunner({store,config,adapterFactory=createGoogleAdapter,clock=()=>new Date().toISOString()}){
 let adapterPromise,tail=Promise.resolve();
 const google=async()=>{if(!config.integrationsEnabled)throw error('Connected services are disabled','integration_disabled');adapterPromise??=Promise.resolve().then(()=>adapterFactory(config)).catch(e=>{adapterPromise=null;throw e;});const adapter=await adapterPromise;if(!adapter.identity?.verified||adapter.identity.email?.toLowerCase()!==config.allowedEmail?.toLowerCase())throw error('Connected identity did not verify','auth_required');return adapter;};
 async function runNow({job,signal,progress=()=>{}}){check(signal);
 if(job.type==='source-sync'){const adapter=await google(),window=currentTermWindow({now:clock(),timeZone:config.timeZone,window:config.calendarWindow});const calendars=await adapter.readSelectedCalendars(window);check(signal);return importCalendarSnapshot({store,config,calendars,window});}
 if(job.type==='backup'){if(!/^[\w-]{1,100}$/.test(job.id))throw error('Invalid backup identifier');progress('Creating a consistent local backup');const backup=await createLocalBackup({store,config,id:job.id,signal});if(!config.integrationsEnabled)return {status:'local-only',integrity:'ok',cloudVerified:false};const archived=await archiveBackup({backup,adapter:await google(),parentId:config.driveFolders?.backups,signal,progress});return {status:'verified',integrity:'ok',cloudVerified:true,...archived};}
 throw error('Unsupported integration job','invalid_job');}
 return {run(input){const operation=tail.then(()=>runNow(input));tail=operation.catch(()=>{});return operation;}};
}
const runners=new WeakMap();
export function runIntegrationJob({store,config,...input}){let runner=runners.get(store);if(!runner){runner=createIntegrationRunner({store,config});runners.set(store,runner);}return runner.run(input);}
