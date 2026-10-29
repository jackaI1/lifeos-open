// A display preference only. Record values and native time inputs remain canonical.
let zone='America/Toronto',format='24h';
export const timeFormatId=value=>value==='12h'?'12h':'24h';
export const getDisplayTimeZone=()=>zone;
export function setDisplayTimeZone(value){new Intl.DateTimeFormat('en',{timeZone:value});zone=value;}
export function cachedTimeFormat(){try{return timeFormatId(globalThis.localStorage?.getItem('lifeos.timeFormat'));}catch{return '24h';}}
export function applyTimeFormat(value,root=globalThis.document?.documentElement){
 format=timeFormatId(value);if(root)root.dataset.timeFormat=format;
 if(root===globalThis.document?.documentElement)try{globalThis.localStorage?.setItem('lifeos.timeFormat',format);}catch{}
 return format;
}
export function parseClockTime(value){
 const match=typeof value==='string'&&/^(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?$/i.exec(value.trim());
 if(!match)return null;
 let hour=Number(match[1]);const minute=Number(match[2]),period=match[3]?.toLowerCase();
 if(minute>59||(period?(hour<1||hour>12):hour>23))return null;
 if(period)hour=hour%12+(period==='p'?12:0);
 return String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
}
export function formatTime(value,{timeZone=zone,seconds=false,timeFormat=format}={}){
 if(value==null||value==='')return '';
 let h,m,s=0;
 if(typeof value==='string'&&/^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)){
  const clock=parseClockTime(value.split(':').slice(0,2).join(':'));if(!clock)return '';
  [h,m]=clock.split(':').map(Number);s=Number(value.split(':')[2]??0);if(s>59)return '';
 }else{
  const date=new Date(value);if(!Number.isFinite(date.valueOf()))return '';
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date),part=type=>Number(parts.find(p=>p.type===type).value);
  h=part('hour');m=part('minute');s=part('second');
 }
 const clock=(timeFormatId(timeFormat)==='12h'?String(h%12||12):String(h).padStart(2,'0'))+':'+String(m).padStart(2,'0')+(seconds?':'+String(s).padStart(2,'0'):'');
 return clock+(timeFormatId(timeFormat)==='12h'?(h<12?' AM':' PM'):'');
}
export const compactTime=formatTime;
export function formatDateTime(value,{timeZone=zone,seconds=false,timeFormat=format,...options}={}){
 if(value==null||value==='')return '';const date=new Date(value);if(!Number.isFinite(date.valueOf()))return '';
 return new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',...options,timeZone}).format(date)+', '+formatTime(date,{timeZone,seconds,timeFormat});
}
