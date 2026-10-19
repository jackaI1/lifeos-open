// Deterministic metadata only. Revision-level editor metadata alone cannot establish entry authorship or dates.
const torontoDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function classifyJournalAdditions(evidence=[]){
 const valid=evidence.filter(e=>e.entryId&&e.sourceSpanVerified===true&&e.previousRevision&&e.revision&&e.newlyIntroduced===true&&Number.isFinite(Date.parse(e.modifiedTime))),days=new Map();
 for(const e of valid){const day=torontoDay(e.modifiedTime);if(!days.has(day))days.set(day,new Set());days.get(day).add(e.entryId);}
 return Object.fromEntries(valid.map(e=>{const day=torontoDay(e.modifiedTime),batch=days.get(day).size>2,daily=e.dailyAuthoredVerified===true;return [e.entryId,{importedAt:e.modifiedTime,devotionalDate:daily?day:null,classification:batch&&!daily?'historical-import-batch':daily?'daily-authored':'historical-import',revision:e.revision,dateBasis:daily?'verified-entry-addition':'addition-is-not-proof-of-writing-date',author:e.exclusiveEditorVerified===true&&['Alex','Adam'].includes(e.author)?e.author:null}];}));
}
export function reconcileHistoricalEntry(entry,{addition=null,importedAt,revisionMetadataCount=0,sourceHash}={}){
 const seven=entry.points?.length===7&&entry.points.every(p=>p.trim());
 const explicit=entry.author?.basis==='explicit'&&['Alex','Adam'].includes(entry.author.name)?entry.author.name:null;
 const sourceNote=entry.kind==='source-note'||entry.flags?.includes('source-note-not-confirmed-entry'),template=entry.flags?.includes('blank-template');
 return {schemaVersion:1,sourceHash:sourceHash??entry.sourceHash,sourceRevision:entry.sourceRevision??null,contentHash:entry.contentHash??null,author:seven?'Alex':explicit??'Alex',authorBasis:seven?'owner-confirmed-seven-arrow-rule':explicit?'explicit-source-boundary':'owner-confirmed-unlabelled-is-Alex',devotionalDate:entry.sourceUpdateDay??entry.date??addition?.devotionalDate??null,dateBasis:entry.sourceUpdateDay?entry.sourceUpdateEvidence?.basis??'verified-document-update-day':entry.date?'explicit-source-date':addition?.dateBasis??'revision-metadata-does-not-identify-entry-date',importedAt:entry.importedAt??addition?.importedAt??importedAt??null,classification:sourceNote?'source-note':template?'template':entry.points?.length!==7||entry.points.some(p=>!p.trim())?'incomplete-reflection':addition?.classification??'historical-import',revisionMetadataCount,contributesToDailyCompletion:false};
}
