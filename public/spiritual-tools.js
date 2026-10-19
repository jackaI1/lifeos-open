import {smallSteps} from './devotional-accountability.js';
export function stepSources(entry){return [4,5].flatMap(arrow=>smallSteps(entry?.points?.[arrow]).map((original,index)=>({key:arrow+'-'+index,arrow,original})));}
export function correctedSteps(entry,corrections=[]){return stepSources(entry).map(s=>{const correction=corrections.map(r=>r.data??r).find(c=>c.entryId===entry.id&&c.key===s.key&&c.original===s.original);return {...s,text:correction?.corrected||s.original,corrected:!!correction};});}
export function messageComparison(before,after){const old=String(before??'').split('\n'),next=String(after??'').split('\n');return {removed:old.filter(line=>line&&!next.includes(line)),added:next.filter(line=>line&&!old.includes(line)),unchanged:before===after};}
export function passageCoverage(book,entries){return Array.from({length:book.chapterCount},(_,i)=>({chapter:i+1,entries:entries.filter(e=>e.complete&&e.chapter<=i+1&&(e.chapterEnd??e.chapter)>=i+1)}));}
