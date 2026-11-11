// Shared by calendar normalization and consumers of older/raw synced entries.
const civilDate=/^\d{4}-\d{2}-\d{2}$/, midnight=/^(\d{4}-\d{2}-\d{2})T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const value=endpoint=>typeof endpoint==='string'?endpoint:endpoint?.dateTime??endpoint?.date;
const dateOnly=endpoint=>typeof endpoint==='string'?civilDate.test(endpoint):!!endpoint?.date&&!endpoint.dateTime;
const nextDate=date=>new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
const formatters=new Map();
function wallTime(endpoint,zone){
 const at=Date.parse(value(endpoint));if(!Number.isFinite(at))return null;
 try{
  let formatter=formatters.get(zone);
  if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});if(formatters.size>=16)formatters.clear();formatters.set(zone,formatter);}
  const p=Object.fromEntries(formatter.formatToParts(at).map(p=>[p.type,p.value]));
  return {date:p.year+'-'+p.month+'-'+p.day,midnight:p.hour==='00'&&p.minute==='00'&&p.second==='00'&&at%1000===0};
 }catch{return null;}
}

/** End dates are exclusive. Duration need not be a multiple of 24h across DST. */
export function allDayCalendarRange(event,timeZone='America/Toronto'){
 if(!event)return null;
 if(event.allDay===true&&civilDate.test(event.allDayStartDate)&&civilDate.test(event.allDayEndDate))return {startDate:event.allDayStartDate,endDate:event.allDayEndDate};
 const start=value(event.start),end=value(event.end),explicit=event.allDay===true||dateOnly(event.start);
 if(dateOnly(event.start)&&dateOnly(event.end)&&end>start)return {startDate:start,endDate:end};
 const a=typeof start==='string'?start.match(midnight):null,b=typeof end==='string'?end.match(midnight):null;
 if(a&&b&&b[1]>a[1]&&Date.parse(end)>Date.parse(start))return {startDate:a[1],endDate:b[1]};
 const zones=[event.start?.timeZone,event.end?.timeZone,event.timeZone,event.timezone,event.source?.timeZone,timeZone,'UTC'].filter(Boolean);
 for(const zone of new Set(zones)){
  const first=wallTime(event.start,zone),last=wallTime(event.end,zone);
  if(first?.midnight&&last?.midnight&&last.date>first.date)return {startDate:first.date,endDate:last.date};
 }
 if(explicit){
  const first=wallTime(event.start,zones[0]??timeZone),last=wallTime(event.end,zones[0]??timeZone);
  const startDate=dateOnly(event.start)?start:first?.date;
  if(startDate)return {startDate,endDate:last?.date>startDate?last.date:nextDate(startDate)};
 }
 return null;
}
export const isAllDayCalendarEvent=(event,timeZone)=>event?.allDay===true||!!allDayCalendarRange(event,timeZone);
// Date-only endpoints on unrelated tasks/projects mean an unrecorded clock.
export const isAllDayScheduleEntry=(item,timeZone)=>item?.allDay===true||!!(item?.kind==='calendar'||item?.calendarId||item?.sourceCalendarId||item?.target?.eventId)&&isAllDayCalendarEvent(item,timeZone);

const text=value=>String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-CA');
/** A read-only projection of already-loaded events, never new reminder records. */
export function calendarDayReminders({events=[],date,reminders=[],lists=[],timeZone='America/Toronto'}){
 const active=new Set(lists.filter(r=>!(r.data??r).archived).map(r=>r.id));
 const native=reminders.map(r=>({...r.data??r,id:r.id})).filter(r=>!r.archived&&active.has(r.listId));
 const seen=new Set();
 return events.flatMap(event=>{
  const range=allDayCalendarRange(event,timeZone);
  if(!range||event.status==='cancelled'||date<range.startDate||date>=range.endDate)return [];
  const sources=event.sources??[{calendarId:event.calendarId??event.sourceCalendarId,eventId:event.providerId??event.source?.eventId??event.id}];
  const key=(event.calendarId??event.sourceCalendarId??'')+':'+event.id+':'+range.startDate;
  if(seen.has(key))return [];seen.add(key);
  const title=event.title??event.summary??'';
  if(native.some(r=>r.calendarEventId===event.id||sources.some(s=>r.source?.eventId&&[s.eventId,event.providerId,event.source?.eventId].includes(r.source.eventId)&&r.source.calendarId===s.calendarId)||text(r.title)===text(title)&&(!r.dueDate||r.dueDate<=date&&(!r.completed||r.dueDate>=range.startDate))))return [];
  return [{id:event.id,title,allDay:true,readOnly:true,...range,sources,htmlLink:event.htmlLink??null,target:{route:'today',eventId:event.id}}];
 });
}
