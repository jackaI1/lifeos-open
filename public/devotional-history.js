import {BIBLE_BOOKS,normalizeBookSearch,parseSelectedPassage} from './bible.js';
import {devotionalDay} from './devotional-day.js';
export function historyEntry(record){
 const decode=x=>typeof x==='string'?(()=>{try{return JSON.parse(x);}catch{return x;}})():x;const d=record.data??record,o=decode(d.displayOverrides)??{},r=decode(d.historyReconciliation),a=decode(d.author);const sourceAuthor=typeof a==='string'?a:['explicit','heading','named','default'].includes(a?.basis)?a.name:null;
 const imported=record.kind==='devotional-import'||d.imported===true;
 if(imported&&(d.sourcePresent===false||d.sourcePresent===0||d.kind&&d.kind!=='journal-entry'||d.historyRole==='book-section'||['template','source-note'].includes(r?.classification)))return null;
 const author='Alex';
 const seven=d.validSeven===1||d.validSeven===true||(Array.isArray(d.points)&&d.points.length===7&&d.points.every(p=>typeof p==='string'&&p.trim()));if(imported&&!seven)return null;
 const date=imported?(o.date??d.sourceUpdateDay??r?.devotionalDate??d.date??null):devotionalDay(d);
 const passage=Object.hasOwn(o,'passage')?o.passage:d.passage;
 const normalized=normalizeBookSearch(passage??'');
 const book=BIBLE_BOOKS.find(b=>b.canonicalId===d.bookId)||BIBLE_BOOKS.find(b=>b.searchAliases.some(a=>normalized===normalizeBookSearch(a)||normalized.startsWith(normalizeBookSearch(a)+' ')));
 const alias=book?.searchAliases.map(normalizeBookSearch).filter(a=>normalized===a||normalized.startsWith(a+' ')).sort((a,b)=>b.length-a.length)[0],chapterText=alias?normalized.slice(alias.length).trim():normalized;
 const chapter=Number(d.chapter??chapterText.match(/^(\d+)/)?.[1]??0),chapterEnd=Number(d.chapterEnd??parseSelectedPassage(passage)?.chapterEnd??chapter);
 return {id:record.id??d.id,type:d.type??'standard',imported,author,date:typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)?date:null,passage:passage||'Passage not confirmed',bookId:book?.canonicalId??null,bookOrder:book?.canonicalOrder??99,chapter,chapterEnd,complete:imported?true:d.complete===true};
}
export function passageGroups(entries){return BIBLE_BOOKS.map(b=>({...b,entries:entries.filter(e=>e.bookId===b.canonicalId).sort((a,c)=>a.chapter-c.chapter||(a.date??'').localeCompare(c.date??''))})).filter(b=>b.entries.length);}
export function completedDays(entries){return new Set(entries.filter(e=>e.complete&&e.date).map(e=>e.date));}
