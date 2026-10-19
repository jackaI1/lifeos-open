import {correctedSteps} from './spiritual-tools.js';
import {devotionalDay} from './devotional-day.js';
const data=r=>({...r.data??r,id:r.id??r.data?.id});
export function smallSteps(answer=''){
 const parts=String(answer??'').split(/\bSmall\s+Step\s*:\s*/gi).slice(1);
 return parts.map(part=>firstSentence(part.split(/\r?\n\s*\r?\n/)[0].trim())).filter(Boolean).slice(0,2);
}
function firstSentence(text){
 const normalized=text.replace(/\s+/g,' ').trim(),segments=[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(normalized)].map(x=>x.segment.trim());
 let first=segments.shift()??'';while(segments.length&&/\b(?:Mr|Mrs|Ms|Dr|Prof|Rev|St)\.$/i.test(first))first+=' '+segments.shift();return first;
}
export function devotionalSmallSteps(entry){return [...new Set([...(smallSteps(entry?.points?.[4])),...(smallSteps(entry?.points?.[5]))])];}
export function repentanceOptions(section){
 if(section?.summary?.length)return section.summary.map(p=>p.text).filter(Boolean).slice(0,8);
 // Extract short source phrases. A saved request is context, never evidence of speech.
 const candidates=(section?.actualSpoken??[]).filter(p=>p.evidence!=='planned-only'&&typeof p.text==='string').flatMap(p=>p.text.split(/(?<=[.!?])\s+|\n+/)).map(s=>s.trim()).filter(Boolean);
 const confessions=candidates.filter(s=>/\b(repent|forgive|sorry|confess|sin|pride|proud|anger|angry|impatien|selfish|jealous|envy|lust|lied|lying|gossip|lazy|laziness)\w*\b/i.test(s));
 return [...new Set((confessions.length?confessions:candidates).map(s=>{const clean=s.replace(/^(?:(?:dear\s+)?(?:God|Lord|Father)[,\s]+)?(?:please\s+)?(?:forgive me (?:for\s+)?|I (?:want to\s+)?(?:repent of|confess)\s+)/i,'').trim();const words=clean.split(/\s+/);return words.length>18?words.slice(0,18).join(' ')+'…':clean;}))].filter(Boolean).slice(0,8);
}
export function accountabilityContext(entry,entries,sessions,corrections=[]){
 const current=data(entry),day=devotionalDay(current),at=Date.parse(current.completedAt??current.updatedAt),previous=entries.map(data).filter(e=>e.id!==current.id&&e.complete&&devotionalDay(e)&&devotionalDay(e)<day).sort((a,b)=>devotionalDay(b).localeCompare(devotionalDay(a))||String(b.completedAt??b.updatedAt??'').localeCompare(String(a.completedAt??a.updatedAt??''))||b.id.localeCompare(a.id))[0]??null;
 const prayer=previous?sessions.map(data).filter(s=>Number.isFinite(Date.parse(s.startedAt))&&Date.parse(s.startedAt)>Date.parse(previous.completedAt)&&Date.parse(s.startedAt)<=at).sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt))[0]??null:null;
 const section=prayer?.processingResult?.sections?.find(s=>s.id==='repentance');
 const repentance=repentanceOptions(section);
 return {entryId:current.id,entryVersion:current.version??null,day,previous,prayer,repentance,previousSteps:correctedSteps(previous,corrections).map(s=>s.text),todaySteps:correctedSteps(current,corrections).map(s=>s.text),fullApplication:[current.points?.[4],current.points?.[5]].filter(Boolean).join('\n\n')};
}
export function accountabilityMessage({context,repentance='',followThrough='',applications=''}){
 return [`What did you repent of?\n${repentance.trim()}`,`Did you do your application from yesterday?\n${[...context.previousSteps.map((s,i)=>(i+1)+'. '+s),followThrough.trim()].filter(Boolean).join('\n')}`,`Devo application today\n${applications.trim().split(/\n+/).filter(Boolean).map((s,i)=>(i+1)+'. '+s.replace(/^\s*\d+[.)]\s*/, '')).join('\n')}`].join('\n\n');
}
