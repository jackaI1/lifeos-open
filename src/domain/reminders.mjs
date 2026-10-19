import {lifeosDay} from '../../public/lifeos-day.js';
import {addDays,zonedDateTime} from './time.mjs';
export function reminderDueAt(data){return data.dueDate&&data.dueTime?zonedDateTime(data.dueDate,data.dueTime,{timeZone:'America/Toronto'}):null;}
export function nextReminderDate(date,repeat){
 if(!date||!repeat||repeat.unit==='none')return null;
 if(repeat.unit==='day'||repeat.unit==='week')return addDays(date,repeat.interval*(repeat.unit==='week'?7:1));
 const d=new Date(date+'T12:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+repeat.interval);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));return d.toISOString().slice(0,10);
}
export function dueReminders({records=[],lists=[],now,timeZone='America/Toronto'}){const day=lifeosDay(now,timeZone),at=Date.parse(now),active=new Set(lists.filter(r=>!(r.data??r).archived).map(r=>r.id));return records.map(r=>({...r.data,id:r.id})).filter(r=>active.has(r.listId)&&!r.archived&&!r.completed&&r.dueDate&&(r.dueAt?Date.parse(r.dueAt)<=at:r.dueDate<=day)).sort((a,b)=>(b.priority??0)-(a.priority??0)||String(a.dueAt??a.dueDate).localeCompare(String(b.dueAt??b.dueDate))||String(a.id).localeCompare(String(b.id)));}
