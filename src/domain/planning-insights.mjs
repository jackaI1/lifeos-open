import {instant,mergeIntervals,localDate,weekday} from './time.mjs';
const done=t=>['complete','completed','submitted','cancelled','archived'].includes(t.status);
export function latestStart({dueAt,remainingMinutes,capacity,now,preparedCapacity=null,timeZone='America/Toronto'}){
 if(!dueAt||!Number.isFinite(remainingMinutes)||remainingMinutes<=0)return {at:null,shortfallMinutes:null};
 const due=Date.parse(dueAt),current=instant(now);if(!Number.isFinite(due))return {at:null,shortfallMinutes:null};
 const slots=preparedCapacity?preparedCapacity.map(s=>({start:Math.max(current,s.start),end:Math.min(due,s.end)})).filter(s=>s.end>s.start).reverse():mergeIntervals(capacity).map(s=>({start:Math.max(current,instant(s.start)),end:Math.min(due,instant(s.end))})).filter(s=>s.end>s.start&&weekday(localDate(s.start,timeZone))!==0).sort((a,b)=>b.start-a.start);
 let needed=remainingMinutes;for(const s of slots){const minutes=(s.end-s.start)/60000;if(minutes>=needed)return {at:new Date(s.end-needed*60000).toISOString(),shortfallMinutes:0};needed-=minutes;}
 return {at:null,shortfallMinutes:Math.ceil(needed),knownCapacityMinutes:Math.round(remainingMinutes-needed)};
}
export function capacityWarning(tasks,capacity,now,timeZone='America/Toronto'){
 const end=instant(now)+7*86400000,endDay=localDate(end,timeZone),active=tasks.filter(t=>!done(t)&&(t.dueAt&&Date.parse(t.dueAt)<=end||!t.dueAt&&t.dueDate&&t.dueDate<=endDay)),unknown=active.filter(t=>!Number.isFinite(t.remainingMinutes??t.estimatedMinutes));
 const required=active.reduce((s,t)=>s+(t.remainingMinutes??t.estimatedMinutes??0),0),available=mergeIntervals(capacity).filter(s=>weekday(localDate(s.start,timeZone))!==0).reduce((s,x)=>s+Math.max(0,(Math.min(end,instant(x.end))-Math.max(instant(now),instant(x.start)))/60000),0);
 return {requiredMinutes:required,availableMinutes:Math.floor(available),shortfallMinutes:Math.max(0,Math.ceil(required-available)),unknownTaskIds:unknown.map(t=>t.id),taskIds:active.map(t=>t.id),coverage:capacity.length?'saved calendar windows':'unavailable'};
}
export function learnedEffort(task,tasks,work){
 if(!task.category)return {count:0,range:null,reason:'Task type is unknown, so effort comparisons would be misleading.'};
 const matching=tasks.filter(t=>done(t)&&t.category===task.category&&t.id!==task.id),samples=matching.map(t=>work.filter(w=>w.taskId===t.id&&Number.isFinite(w.minutes)&&w.minutes>0).reduce((n,w)=>n+w.minutes,0)).filter(n=>n>0).sort((a,b)=>a-b);
 if(samples.length<3)return {count:samples.length,range:null,reason:'At least three completed tasks with recorded work are needed.'};
 return {count:samples.length,range:{minMinutes:Math.round(samples[Math.floor((samples.length-1)*.25)]),maxMinutes:Math.round(samples[Math.ceil((samples.length-1)*.75)])},reason:'Recorded work from completed tasks of the same type. Unrecorded effort is unknown.'};
}
export function validateDependencies(id,dependencies,tasks){
 if(!Array.isArray(dependencies)||dependencies.length>15||new Set(dependencies).size!==dependencies.length)throw Error('Choose at most fifteen distinct prerequisites.');const map=new Map(tasks.map(t=>[t.id,t]));if(dependencies.some(d=>d===id||!map.has(d)))throw Error('Choose existing tasks other than this task.');
 const visit=(key,path)=>{if(path.has(key))throw Error('These prerequisites would form a cycle.');const next=new Set(path).add(key);for(const d of key===id?dependencies:map.get(key)?.dependencies??[])visit(d,next);};visit(id,new Set());return dependencies;
}
export {moveConsequences,replanRemaining} from '../../public/planning-actions.js';
export function dayCarryForward(tasks,day,timeZone='America/Toronto'){return tasks.filter(t=>!done(t)&&!t.archived&&(t.dueDate&&t.dueDate<=day||t.dueAt&&localDate(t.dueAt,timeZone)<=day)).map(t=>({id:t.id,title:t.title,originalDeadline:t.dueAt??t.dueDate,status:t.status??'open'}));}
