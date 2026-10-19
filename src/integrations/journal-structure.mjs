import {BIBLE_BOOKS,normalizeBookSearch} from '../../public/bible.js';
const headings=new Map(BIBLE_BOOKS.map(book=>[normalizeBookSearch(book.archiveHeadingText),book]));
const titles=new Map(BIBLE_BOOKS.map(book=>[normalizeBookSearch(book.displayName),book]));
export function journalSectionHeading(text,namedStyleType){const key=normalizeBookSearch(text);return headings.get(key)??(namedStyleType==='TITLE'?titles.get(key):null)??null;}
export function structuralJournalRecord(data){return journalSectionHeading(data.rawText??'',data.nativeSpans?.some(s=>s.namedStyleType==='TITLE')?'TITLE':null);}
