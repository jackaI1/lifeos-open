import {el,safeLink} from './ui.js';
import {controlIcon} from './quiet-controls.js';
export function locationDetails(event,timeline=[]){
 if(!event?.location?.trim())return null;
 const before=timeline.filter(t=>['commute','travel'].includes(t.kind)&&t.end&&Date.parse(t.end)<=Date.parse(event.start)&&Date.parse(event.start)-Date.parse(t.end)<=30*60000).at(-1);
 const minutes=before?Math.round((Date.parse(before.end)-Date.parse(before.start))/60000):null;
 const transit=before&&/bus|transit/i.test(before.title);
 return {estimated:before?.estimated===true,location:event.location,minutes:minutes>0?minutes:null,mode:transit?'transit':'walking',url:'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(event.location)+'&travelmode='+'transit'};
}
export function scheduleLocation(event,timeline){
 const data=locationDetails(event,timeline);if(!data)return null;
 if(!safeLink(data.url))return el('span',{class:'schedule-destination'},el('span',{class:'schedule-location'},data.location));
 return el('a',{class:'schedule-destination',href:data.url,target:'_blank',rel:'noopener noreferrer','aria-label':'Navigate to '+data.location,title:data.minutes?`${data.minutes} min of scheduled travel. Open Maps for the current route.`:'Open Maps for directions and travel time.'},data.minutes?el('span',{class:'schedule-travel'},controlIcon(data.mode==='transit'?'bus':'walk'),`${data.estimated?'~':''}${data.minutes}m`):null,el('span',{class:'schedule-location'},data.location));
}
