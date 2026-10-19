import {BIBLE_BOOKS,normalizeBookSearch,parseSelectedPassage} from './bible.js';
import {devotionalDay} from './devotional-day.js';
export function historyEntry(record){
 const d=record.data??record,date=devotionalDay(d),passage=d.passage;
 const normalized=normalizeBookSearch(passage??'');
 const book=BIBLE_BOOKS.find(b=>b.canonicalId===d.bookId)||BIBLE_BOOKS.find(b=>b.searchAliases.some(a=>normalized===normalizeBookSearch(a)||normalized.startsWith(normalizeBookSearch(a)+' ')));
 const alias=book?.searchAliases.map(normalizeBookSearch).filter(a=>normalized===a||normalized.startsWith(a+' ')).sort((a,b)=>b.length-a.length)[0],chapterText=alias?normalized.slice(alias.length).trim():normalized;
 const chapter=Number(d.chapter??chapterText.match(/^(\d+)/)?.[1]??0),chapterEnd=Number(d.chapterEnd??parseSelectedPassage(passage)?.chapterEnd??chapter);
 return {id:record.id??d.id,type:d.type??'standard',author:'You',date:typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)?date:null,passage:passage||'Passage not confirmed',bookId:book?.canonicalId??null,bookOrder:book?.canonicalOrder??99,chapter,chapterEnd,complete:d.complete===true};
}
export function passageGroups(entries){return BIBLE_BOOKS.map(b=>({...b,entries:entries.filter(e=>e.bookId===b.canonicalId).sort((a,c)=>a.chapter-c.chapter||(a.date??'').localeCompare(c.date??''))})).filter(b=>b.entries.length);}
export function completedDays(entries){return new Set(entries.filter(e=>e.complete&&e.date).map(e=>e.date));}
