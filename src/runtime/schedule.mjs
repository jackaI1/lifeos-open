import {lifeosDay} from '../../public/lifeos-day.js';
import{buildToday,localDate,weekday,academicAutomationAllowed}from'../domain/index.mjs';import{quietNow}from'../server/push.mjs';
export function scheduleTick({store,config,now=new Date().toISOString()}){
 if(store.meta('migrationQuiesced'))return {paused:true,reason:'Local store retained read-only after cloud cutover',queued:[]};
 const prefs=store.get('settings','preferences')?.data??{},timeZone=prefs.timezone??config.timeZone??'America/Toronto',date=lifeosDay(now,timeZone),clock=new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now));const queued=[];
 const once=(key,type,payload,priority=6)=>store.transaction(()=>{if(store.meta('schedule:'+key))return;const job=store.enqueue(type,payload,{priority,authority:'configured-scheduler'});store.meta('schedule:'+key,{jobId:job.id,at:now});queued.push(job.id);});
 if(store.meta('automationPaused'))return{paused:true,queued};
 if(config.environment==='production'&&config.integrationsEnabled){
  if(clock>='02:00'&&!config.backupsPaused)once('backup:'+date,'backup',{},7);
  if(academicAutomationAllowed({now,settings:{timeZone}})){const quarter=Math.floor(new Date(now).getTime()/900000);once('sources:'+quarter,'source-sync',{scope:'incremental'},5);}
 }
 if(store.list('push-subscription').some(s=>!s.data.disabled)){
  const records=store.all(),events=store.list('calendar-event',{limit:25000}).map(r=>r.data);
  const today=buildToday({now,records,events,settings:{...prefs,allowedCalendarIds:Object.values(config.calendarIds??{}),schoolCalendarIds:[config.calendarIds?.schoolA,config.calendarIds?.schoolB].filter(Boolean)}});
  const current=Date.parse(now),sleeping=today.blocks.some(block=>block.kind==='sleep'&&Date.parse(block.start)<=current&&Date.parse(block.end)>current);
  const wake=weekday(localDate(now,timeZone))===6?(prefs.saturdayWakeTime??'07:00'):(prefs.wakeTime??'06:30'),bed=weekday(localDate(now,timeZone))===5?(prefs.fridayBedtime??prefs.lightsOut??'22:00'):(prefs.lightsOut??'22:00');
  const awake=wake<bed?clock>=wake&&clock<bed:clock>=wake||clock<bed;
  if(awake&&prefs.hourlyPrayerReminder!==false){const hour=clock.slice(0,2),civilDay=localDate(now,timeZone);once('hourly-prayer:'+date+':'+civilDay+':'+hour,'notification',{id:'hourly-prayer-'+civilDay+'-'+hour,route:'prayer',notice:'hourly-prayer',expiresAt:Math.min(current+10*60000,Math.floor(current/3600000)*3600000+3600000)},9);}
  const unfinished=Object.values(today.spiritual).filter(state=>state?.complete===false),recovery=unfinished.some(state=>state.plan==='D');
  if(!sleeping&&!quietNow(now,prefs))for(const state of unfinished){
   if(state.kind==='prayer'&&prefs.hourlyPrayerReminder!==false)continue;
   const campusDay=['weekday','friday'].includes(today.dayType),start=Date.parse(state.slot?.start),end=Date.parse(state.slot?.end);
   const due=state.plan==='D'||campusDay&&(state.plan==='B'&&start<=current+5*60000&&end>current||state.plan==='C'&&current>=Date.parse(today.releaseAt)-5*60000);
   if(due){const key=`spiritual:${today.date}:${state.kind}:${state.plan}`;once(key,'notification',{id:key,route:state.kind,notice:'practice-due',practice:state.kind,expiresAt:current+15*60000},8);}
  }
  if(!quietNow(now,prefs))for(const job of store.jobs(100)){if(job.status!=='completed'||job.type!=='support'||Date.parse(now)-Date.parse(job.updatedAt)>3600000)continue;once('job:'+job.id,'notification',{id:'job-'+job.id,route:'support',notice:'reply-ready',expiresAt:current+3600000},9);}


 }
 return{paused:false,queued};
}
