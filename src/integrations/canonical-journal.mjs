import {BIBLE_BOOKS,selectedPassage,parseSelectedPassage,normalizeBookSearch} from '../../public/bible.js';
const fail=message=>{throw Object.assign(Error(message),{code:'document_conflict'});};
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
const headingBooks=new Map(BIBLE_BOOKS.map(book=>[normalizeBookSearch(book.archiveHeadingText),book]));
export function journalStructure(tab){
 const paragraphs=[];
 function walk(items,insideTable=false){for(const e of items??[]){if(e.paragraph)paragraphs.push({start:e.startIndex,end:e.endIndex,text:e.paragraph.elements?.map(x=>x.textRun?.content??'').join('')??'',paragraph:e.paragraph,insideTable});for(const row of e.table?.tableRows??[])for(const cell of row.tableCells??[])walk(cell.content,true);}}
 walk(tab.body?.content);
 const sections=paragraphs.filter(p=>p.paragraph.paragraphStyle?.namedStyleType==='TITLE').map(p=>({...p,book:headingBooks.get(normalizeBookSearch(p.text))})).filter(p=>p.book);
 return {paragraphs,sections};
}
function style(tab,paragraph){
 const type=paragraph?.paragraphStyle?.namedStyleType??'NORMAL_TEXT',named=tab.namedStyles?.styles?.find(s=>s.namedStyleType===type);
 return {paragraphStyle:pick({...named?.paragraphStyle,...paragraph?.paragraphStyle},['namedStyleType','alignment','direction','lineSpacing','spaceAbove','spaceBelow','keepWithNext','keepLinesTogether','avoidWidowAndOrphan']),textStyle:pick({...named?.textStyle,...paragraph?.elements?.find(e=>e.textRun)?.textRun?.textStyle},['bold','italic','underline','strikethrough','fontSize','weightedFontFamily','foregroundColor','backgroundColor','baselineOffset'])};
}
export function planCanonicalEntry({tab,bookId,chapter,chapterEnd,points,existingRange=null,allowAdditionalEntry=false}){
 const chosen=selectedPassage(bookId,chapter,chapterEnd??chapter),book=BIBLE_BOOKS.find(b=>b.canonicalId===bookId);
 if(!Array.isArray(points)||points.length!==7||points.some(p=>typeof p!=='string'||!p.trim()))throw Error('Seven reflections are required for journal synchronization.');
 const {paragraphs,sections}=journalStructure(tab),matches=sections.filter(s=>s.book.canonicalId===bookId);
 if(matches.length>1)fail('More than one book section matches. Review the journal before inserting.');
 const ordered=[...sections].sort((a,b)=>a.start-b.start);for(let i=1;i<ordered.length;i++)if(ordered[i].book.canonicalOrder<=ordered[i-1].book.canonicalOrder)fail('Book sections are not in unambiguous canonical order.');
 const section=matches[0],next=section?ordered.find(s=>s.start>section.start):ordered.find(s=>s.book.canonicalOrder>book.canonicalOrder);
 const end=next?.start??tab.body?.content?.at(-1)?.endIndex-1;
 if(!Number.isInteger(end)||end<1)fail('A safe insertion boundary was not found.');
 const chapters=section?paragraphs.filter(p=>p.start>section.start&&p.start<end).map(p=>({...p,selected:parseSelectedPassage(p.text.trim().replace(/^DAY\s+\d+\s*:\s*\[?(.*?)\]?$/i,'$1'))})).filter(p=>p.selected?.bookId===bookId):[];
 const sectionParagraphs=section?paragraphs.filter(p=>p.start>section.start&&p.start<end):[];
 for(const p of sectionParagraphs){const text=p.text.trim().replace(/^DAY\s+\d+\s*:\s*\[?(.*?)\]?$/i,'$1'),prefixes=book.searchAliases.map(normalizeBookSearch);if(prefixes.some(prefix=>normalizeBookSearch(text).startsWith(prefix+' '))&&/\d\s*[-–,:]\s*\d/.test(text)&&!parseSelectedPassage(text))fail('A historical passage range needs review before insertion. Its content was preserved.');}
 for(let i=1;i<chapters.length;i++)if(chapters[i].selected.chapter<chapters[i-1].selected.chapter)fail('Historical chapter order is ambiguous. Nothing was changed.');
 if(!existingRange&&!allowAdditionalEntry&&chapters.some(p=>p.selected.chapter<=(chosen.chapterEnd??chapter)&&(p.selected.chapterEnd??p.selected.chapter)>=chapter))fail('This chapter already has a historical entry. Nothing was overwritten. Choose another passage or resolve the conflict.');
 if(existingRange){const current=paragraphs.find(p=>p.start===existingRange.startIndex);const old=current&&parseSelectedPassage(current.text.trim());if(!old||old.bookId!==bookId||old.chapter!==chapter||(old.chapterEnd??old.chapter)!==(chosen.chapterEnd??chapter))fail('Changing the passage of an already archived entry requires review. Its original location was preserved.');}
 let start=existingRange?.startIndex??chapters.find(p=>p.selected.chapter>chapter)?.start??end;
 if(paragraphs.find(p=>p.start===start)?.insideTable||section?.insideTable)fail('This insertion boundary is inside a historical table. Its contents were preserved.');
 const heading=section?'':book.archiveHeadingText+'\n';
 const entryText=chosen.passage+'\n'+points.map((point,i)=>`${i+1}. ${point.replace(/\r\n?/g,'\n')}`).join('\n')+'\n';
 const headingSample=sections.at(-1)?.paragraph;
 const boundarySample=[...paragraphs].reverse().find(p=>parseSelectedPassage(p.text.trim())&&p.paragraph.paragraphStyle?.namedStyleType!=='TITLE');
 const bodySample=boundarySample&&paragraphs.find(p=>p.start===boundarySample.end);
 return {start,heading,entryText,text:heading+entryText,entryStart:start+heading.length,chapterLength:chosen.passage.length+1,headingStyle:style(tab,headingSample),chapterStyle:style(tab,boundarySample?.paragraph),bodyStyle:style(tab,bodySample?.paragraph)};
}
export function canonicalStyleRequests(plan,tabId){
 const range=(startIndex,endIndex)=>({startIndex,endIndex,...(tabId?{tabId}:{})});const requests=[];
 function apply(start,end,styles,body=false){if(end<=start)return;const r=range(start,end);requests.push({deleteParagraphBullets:{range:r}});const paragraphStyle={...styles.paragraphStyle,indentStart:{magnitude:0,unit:'PT'},indentEnd:{magnitude:0,unit:'PT'},indentFirstLine:{magnitude:0,unit:'PT'}};
 if(body)paragraphStyle.namedStyleType='NORMAL_TEXT';requests.push({updateParagraphStyle:{range:r,paragraphStyle,fields:Object.keys(paragraphStyle).join(',')}});
 const textStyle={bold:false,italic:false,underline:false,strikethrough:false,...styles.textStyle};requests.push({updateTextStyle:{range:r,textStyle,fields:Object.keys(textStyle).join(',')}});}
 if(plan.heading)apply(plan.start,plan.entryStart,plan.headingStyle);
 apply(plan.entryStart,plan.entryStart+plan.chapterLength,plan.chapterStyle,true);
 apply(plan.entryStart+plan.chapterLength,plan.start+plan.text.length,plan.bodyStyle,true);
 return requests;
}
