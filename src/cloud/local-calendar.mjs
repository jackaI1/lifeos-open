import * as v from '../server/validation.mjs';
import {AppError} from '../shared/errors.mjs';
import {loadPlan,commitPlan} from './records.mjs';
import {digest} from './store.mjs';
export async function localCalendar({store,path,body}){
 v.exactFields(body,['mutationId','id','version','title','start','end','location','deleted']);v.mutationId(body.mutationId);v.identifier(body.id);v.version(body.version);
 const prior=await store.mutation(body.mutationId,await digest(JSON.stringify({path,body})));if(prior)return Response.json(prior);
 const plan=await loadPlan(store,['calendar-event','schedule-correction']),before=plan.get('calendar-event',body.id);if((before?.version??0)!==body.version)throw new AppError('This event changed. Reopen it before saving.',409);
 const title=v.text(body.title,300,{required:true}),location=v.text(body.location??'',3000);const start=Date.parse(body.start),end=Date.parse(body.end);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>86400000)throw new AppError('Choose an end time after the start, within one day.');
 const data={...before?.data,title,location,calendarId:before?.data.calendarId??'demo-personal',start:{dateTime:new Date(start).toISOString()},end:{dateTime:new Date(end).toISOString()},status:body.deleted?'cancelled':'confirmed',sourceMissing:false};
 for(const correction of plan.list('schedule-correction').filter(r=>r.data.entryId==='plan:calendar:'+body.id&&!r.data.undone))plan.put('schedule-correction',correction.id,{...correction.data,undone:true},correction.version,{actor:'owner-local-calendar'});
 const item=plan.put('calendar-event',body.id,data,body.version,{actor:'owner-local-calendar'});return Response.json(await commitPlan(store,plan,{id:body.mutationId,fingerprint:{path,body},result:{item}}));
}
