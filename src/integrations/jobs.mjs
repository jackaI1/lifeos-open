import {schoolPath} from '../shared/service-config.mjs';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,realpath,stat} from 'node:fs/promises';
import {readFileSync,realpathSync as fsRealpathSync,statSync,unlinkSync,existsSync} from 'node:fs';
import {join,relative,isAbsolute,sep,dirname,basename} from 'node:path';
import {createGoogleAdapter} from './google.mjs';
import {parseJournal,planJournalImport,JOURNAL_QUESTIONS} from './import-journal.mjs';
import {importPrayerNotes,mergePrayerNote,processPrayerAudio,renderPrayerJournal,prayerRetention,prayerProcessingPrefix} from './prayer.mjs';
import {mergeSchoolRecord,schoolIngestionWindow} from './school.mjs';
import {collectSchoolRuntime,mergeRuntimeCatalogue,schoolHome} from './school-runtime.mjs';
import {collectPortalRuntime,mergePortalRecord,nextSchoolBrowserWork,PORTALS} from './portal-runtime.mjs';
import {localDate,zonedDateTime,validDate} from '../domain/time.mjs';
import {PRAYER_SECTIONS} from '../domain/defaults.mjs';
import {createLocalBackup,archiveBackup,fileSha256} from './backups.mjs';

const hash=value=>createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value)).digest('hex');
const realpathSync=path=>fsRealpathSync.native(path);
const error=(message,code='integration_blocked')=>Object.assign(new Error(message),{code});
const check=signal=>{if(signal?.aborted)throw error('Processing stopped. Saved source files and writing remain preserved.','cancelled');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sourceId=value=>typeof value==='string'?value:value?.id??value?.fileId;
const itemData=item=>item?.data??item;
const recordList=(store,kind)=>store.db.prepare('SELECT id,data FROM records WHERE kind=?').all(kind).map(r=>({id:r.id,...JSON.parse(r.data)}));
const putChanged=(store,kind,id,data,actor='source-sync')=>{const old=store.get(kind,id);return old&&same(old.data,data)?old:store.put(kind,id,data,old?.version??0,{actor});};
const status=(store,id,data)=>{const old=store.get('integration',id);return putChanged(store,'integration',id,{...old?.data,...data},'integration-status');};
const safeId=value=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(value??''))throw error('Invalid integration record ID','invalid_input');return value;};
const folders=config=>config.driveFolders??config.googleFolderIds??{};
async function privatePath(root,path){const base=await realpath(root),target=await realpath(path),rel=relative(base,target);if(!rel||rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw error('Private file is outside the configured storage directory','unsafe_path');return target;}
async function jsonIfPresent(config,...parts){try{return JSON.parse(await readFile(await privatePath(config.dataDir,join(config.dataDir,...parts)),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function saveImmutable(config,path,text){await mkdir(join(path,'..'),{recursive:true});await privatePath(config.dataDir,join(path,'..'));try{await writeFile(path,text,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}if(hash(await readFile(await privatePath(config.dataDir,path)))!==hash(text))throw error('An existing private artifact differs; both versions need review','artifact_conflict');return {path,sha256:hash(text),durable:true,archiveId:null,readbackSha256:null};}

function flattenTabs(document){const result=[];function add(tabs){for(const tab of tabs??[]){if(tab.documentTab)result.push({id:tab.tabProperties?.tabId??null,data:tab.documentTab});add(tab.childTabs);}}add(document.tabs);if(!result.length&&document.body)result.push({id:null,data:document});return result;}

/** Preserve native offsets while excluding only this app's exact managed ranges from historical import. */
export function journalParagraphs(document){
  const paragraphs=[];
  for(const tab of flattenTabs(document)){
    const excluded=[];for(const [name,group] of Object.entries(tab.data.namedRanges??{}))if(name.startsWith('lifeos.entry.'))for(const named of group.namedRanges??[])for(const range of named.ranges??[])if((range.tabId??tab.id)===tab.id&&Number.isInteger(range.startIndex)&&Number.isInteger(range.endIndex))excluded.push(range);
    function content(elements){for(const element of elements??[]){
      if(element.paragraph){let text='';for(const part of element.paragraph.elements??[]){if(!part.textRun)continue;const value=part.textRun.content??'',start=part.startIndex??element.startIndex;let slices=[{start,end:start+value.length}];for(const cut of excluded)slices=slices.flatMap(s=>cut.endIndex<=s.start||cut.startIndex>=s.end?[s]:[{start:s.start,end:Math.min(s.end,cut.startIndex)},{start:Math.max(s.start,cut.endIndex),end:s.end}].filter(s=>s.end>s.start));text+=slices.map(s=>value.slice(s.start-start,s.end-start)).join('');}
        if(text)paragraphs.push({text,startIndex:element.startIndex,endIndex:element.endIndex,tabId:tab.id,namedStyleType:element.paragraph.paragraphStyle?.namedStyleType??null,isListItem:!!element.paragraph.bullet,listId:element.paragraph.bullet?.listId??null,listNestingLevel:element.paragraph.bullet?.nestingLevel??0,listGlyphType:tab.data.lists?.[element.paragraph.bullet?.listId]?.listProperties?.nestingLevels?.[element.paragraph.bullet?.nestingLevel??0]?.glyphType??null});
      }
      for(const row of element.table?.tableRows??[])for(const cell of row.tableCells??[])content(cell.content);
      if(element.tableOfContents)content(element.tableOfContents.content);
    }}content(tab.data.body?.content);
  }
  return paragraphs;
}

export function currentTermWindow({now=new Date().toISOString(),timeZone='America/Toronto',term}={}){
  const date=localDate(now,timeZone),year=Number(date.slice(0,4)),month=Number(date.slice(5,7)),startMonth=month<=4?1:month<=8?5:9;
  const startDate=term?.startDate??`${year}-${String(startMonth).padStart(2,'0')}-01`,endDate=term?.endDate??(startMonth===9?`${year+1}-01-01`:`${year}-${String(startMonth+4).padStart(2,'0')}-01`);
  if(!validDate(startDate)||!validDate(endDate)||endDate<=startDate||(Date.parse(endDate)-Date.parse(startDate))/86400000>200)throw error('Configure a valid bounded academic term','configuration_missing');
  return {timeMin:zonedDateTime(startDate,'00:00',{timeZone}),timeMax:zonedDateTime(endDate,'00:00',{timeZone}),startDate,endDate,coverage:'selected-calendars-expanded-term'};
}

export function importJournalSource({store,source,configuredSourceId}){
  const actual=source.file?.id??source.document?.documentId;if(!configuredSourceId||actual!==configuredSourceId||!source.document)throw error('The imported document is not the configured original journal','source_mismatch');
  const parsed=parseJournal({paragraphs:journalParagraphs(source.document),sourceId:actual,sourceRevision:source.document.revisionId??null});
  const previousEntries=recordList(store,'devotional-import'),plan=planJournalImport({parsed,previousEntries});
  store.transaction(()=>{
    for(const entry of plan.insert)putChanged(store,'devotional-import',entry.id,entry,'journal-import');
    for(const entry of plan.refresh){const old=store.get('devotional-import',entry.id);putChanged(store,'devotional-import',entry.id,{...entry,...old.data,sourceRevision:entry.sourceRevision,sourceHash:entry.sourceHash,nativeSpans:entry.nativeSpans,sourceMissing:false},'journal-import');}
    for(const id of plan.missingPreviousIds){const old=store.get('devotional-import',id);putChanged(store,'devotional-import',id,{...old.data,sourceMissing:true,requiresSourceReview:true},'journal-import');}
    status(store,'devotional-source',{status:plan.requiresReview?'needs-review':'ready',lastSuccess:new Date().toISOString(),sourceId:actual,sourceHash:parsed.source.sha256,revision:parsed.source.revision,entries:parsed.entries.length,requiresReview:plan.requiresReview});
  });
  return {imported:plan.insert.length,refreshed:plan.refresh.length,preservedMissing:plan.missingPreviousIds.length,diagnostics:parsed.diagnostics,sourceId:actual};
}

export function importCalendarSnapshot({store,config,calendars,window}){
  const allowed=Object.values(config.calendarIds??{});if(allowed.length!==4||new Set(allowed).size!==4||!Array.isArray(calendars)||calendars.length!==4||new Set(calendars.map(c=>c.calendarId)).size!==4)throw error('All four selected calendars must be verified together','calendar_contract');
  for(const calendar of calendars)if(!allowed.includes(calendar.calendarId)||calendar.complete!==true||!['reader','writer','owner'].includes(calendar.accessRole)||!Array.isArray(calendar.events))throw error('The selected calendar read is incomplete or unauthorized','calendar_contract');
  const personal=calendars.find(c=>c.calendarId===config.calendarIds.personal);if(!['writer','owner'].includes(personal?.accessRole))throw error('Personal calendar write access is unavailable','calendar_contract');
  let count=0,suppressed=0;
  store.transaction(()=>{for(const calendar of calendars){const seen=new Set();for(const event of calendar.events){if(typeof event.id!=='string'||!event.id)throw error('Calendar event has no stable provider ID','calendar_contract');const id=`calendar-${hash([calendar.calendarId,event.id]).slice(0,40)}`,old=store.get('calendar-event',id);seen.add(id);
      const data={...old?.data,...event,calendarId:calendar.calendarId,providerId:event.id,sourceMissing:false,source:{provider:'google-calendar',calendarId:calendar.calendarId,eventId:event.id,updated:event.updated??null}};delete data.id;putChanged(store,'calendar-event',id,data,'calendar-sync');count++;
    }
    for(const prior of store.list('calendar-event',{limit:100000})){const start=prior.data.start?.dateTime??prior.data.start?.date??prior.data.start;if(prior.data.calendarId!==calendar.calendarId||seen.has(prior.id)||!start)continue;const instant=Date.parse(start);if(instant>=Date.parse(window.timeMin)&&instant<Date.parse(window.timeMax)){putChanged(store,'calendar-event',prior.id,{...prior.data,status:'cancelled',sourceMissing:true,sourceMissingReason:'Absent from a complete bounded source read; retained for review'},'calendar-sync');suppressed++;}}
    status(store,`calendar-${hash(calendar.calendarId).slice(0,16)}`,{status:'ready',calendarId:calendar.calendarId,accessRole:calendar.accessRole,lastSuccess:calendar.fetchedAt??new Date().toISOString(),events:calendar.events.length,window});
  }});
  return {calendars:4,events:count,suppressedMissing:suppressed,window};
}

/** This is build initialization authority. Never expose initialSetup as an accepted web job payload. */
export async function seedLocalImports({store,config,initialSetup=false,now=new Date().toISOString()}){
  if(config.environment!=='production'||config.integrationsEnabled!==true)return {status:'disabled',reason:'Real source imports are disabled in this environment'};
  const schoolAllowed=initialSetup===true||schoolIngestionWindow({now,timeZone:config.timeZone??'America/Toronto'}).allowed,result={prayer:0,school:0,training:0,calendars:null,schoolStatus:schoolAllowed?'not-found':'deferred'};
  const prayer=await jsonIfPresent(config,'imports','prayer','normalized-records.json');
  if(prayer){const records=Array.isArray(prayer)?prayer:prayer.records;if(!Array.isArray(records))throw error('Prayer import file has an unsupported format');store.transaction(()=>{for(const record of records){if(record.kind!=='prayer-note'||record.data?.source?.sourceId!==sourceId(config.sourceIds?.prayer_structure))throw error('Prayer import source does not match the configured original');const merged=mergePrayerNote(store.get(record.kind,record.id),record);putChanged(store,record.kind,record.id,merged.data,'source-seed');result.prayer++;}});}
  const training=await jsonIfPresent(config,'imports','training','normalized-source.json');if(training){if(training.source?.sourceId!==sourceId(config.sourceIds?.training)&&training.source?.id!==sourceId(config.sourceIds?.training))throw error('Training import source does not match the configured original');const old=store.get('training-source','beginner-source');putChanged(store,'training-source','beginner-source',{...training,...(old?.data.userNotes?{userNotes:old.data.userNotes}:{})},'source-seed');result.training=1;}
  if(schoolAllowed){const school=await jsonIfPresent(config,'imports','school','normalized-records.json');if(school){if(!Array.isArray(school.records))throw error('School import file has an unsupported format');const seedDigest=hash(school);if(store.meta('schoolSeedDigest')!==seedDigest){store.transaction(()=>{for(const record of school.records){if(!['course','material','task'].includes(record.kind)||!record.data?.source?.sourceUrl)throw error('School import lacks source provenance');const old=store.get(record.kind,record.id),latest=old?.data.sourceRefresh?.source?.retrievedAt??old?.data.catalogueObservedAt??old?.data.source?.retrievedAt;if(old&&Date.parse(latest)>Date.parse(record.data.source.retrievedAt))continue;const merged=mergeSchoolRecord(old,record);putChanged(store,record.kind,record.id,merged.data,'source-seed');result.school++;}store.meta('schoolSeedDigest',seedDigest);});result.schoolStatus='imported';}else result.schoolStatus='unchanged';}
    // Only the explicit build initialization may consume the initial calendar snapshot.
    if(initialSetup){const calendars=await jsonIfPresent(config,'imports','calendars','initial-term.json');if(calendars)result.calendars=importCalendarSnapshot({store,config,calendars,window:currentTermWindow({now,term:config.academicTerm})});}
  }
  return result;
}

function devotionalText(data){return [`${data.date}`,data.passage||'Passage not recorded',...(data.readingPlan?[`Reading plan: ${data.readingPlan}`]:[]),'',...JOURNAL_QUESTIONS.flatMap((q,index)=>[`${index+1}. ${q}`,data.points[index],''])].join('\n');}
export const devotionalDigest=data=>hash({date:data.date,passage:data.passage??'',readingPlan:data.readingPlan??'',points:data.points,complete:data.complete});
const reviewedDigest=data=>hash({transcript:data.cleanedTranscript??data.transcriptText??'',reviewVersion:data.reviewVersion??null,reviewedSections:data.reviewedSections??null,humanReviewed:data.humanReviewed===true,seriousUncertainty:data.seriousUncertainty!==false});

function reviewedPrayer(data){
  const transcript=data.cleanedTranscript??data.transcriptText??'',sections=PRAYER_SECTIONS.map(s=>({...s,actualSpoken:[],plannedRequests:(data.sectionsStructured??data.processingResult?.sections??[]).find(x=>x.id===s.id)?.plannedRequests??[]}));
  const assignments=data.reviewedSections;let assigned=false;
  if(Array.isArray(assignments)&&assignments.length===6){const seen=new Set();for(const part of assignments){const section=typeof part.section==='number'?PRAYER_SECTIONS[part.section]:PRAYER_SECTIONS.find(s=>s.id===part.section);if(!section||seen.has(section.id)||typeof part.text!=='string')throw error('Reviewed prayer section assignments are invalid','review_required');seen.add(section.id);if(part.text.trim())sections.find(s=>s.id===section.id).actualSpoken.push({text:part.text,evidence:'owner-reviewed',uncertain:false});}
    const normalize=value=>value.trim().replace(/\s+/g,' ');assigned=normalize(sections.flatMap(s=>s.actualSpoken.map(x=>x.text)).join(' '))===normalize(transcript);
  }
  if(!assigned)for(const section of sections)section.actualSpoken=[];
  return {cleanedTranscript:transcript,sections,unassigned:assigned?[]:[{text:transcript,evidence:'owner-reviewed-transcript-unassigned'}],qualityFlags:assigned?[]:['Reviewed transcript section assignment remains unconfirmed. Raw recording is retained.'],humanReviewed:data.humanReviewed===true,seriousUncertainty:data.seriousUncertainty!==false||!assigned,assignmentsVerified:assigned};
}

export function createIntegrationRunner({store,config,adapterFactory=createGoogleAdapter,processAudio=processPrayerAudio,collectSchool=collectSchoolRuntime,collectPortal=collectPortalRuntime,clock=()=>new Date().toISOString()}){
  let adapterPromise,tail=Promise.resolve();
  const google=async()=>{if(config.environment!=='production'||config.integrationsEnabled!==true)throw error('Real Google destinations are disabled in this environment','integration_disabled');adapterPromise??=Promise.resolve().then(()=>adapterFactory(config)).catch(e=>{adapterPromise=null;throw e;});return adapterPromise;};
  async function sourceSync({signal,progress,initialSetup=false}){
    const adapter=await google();check(signal);if(adapter.identity?.verified!==true||adapter.identity.email!==config.allowedEmail)throw error('The connected Google identity does not match the allowed owner','auth_required');status(store,'google',{status:'ready',lastSuccess:clock(),identityVerified:true});
    const seed=await seedLocalImports({store,config,initialSetup,now:clock()});progress('Reading the original devotional source');const source=await adapter.readSource('devotional_journal');check(signal);const journal=importJournalSource({store,source,configuredSourceId:sourceId(config.sourceIds?.devotional_journal)});
    let prayer={status:'local-source-preserved'};if(config.sourceIds?.prayer_structure){check(signal);const read=await adapter.readSource('prayer_structure');let text;if(read.document)text=journalParagraphs(read.document).map(p=>p.text).join('');else if(/^text\//.test(read.file.mimeType??''))text=read.bytes.toString('utf8');if(text!==undefined){const parsed=importPrayerNotes({text,sourceId:read.file.id,sourceRevision:read.document?.revisionId??read.file.version??null,retrievedAt:clock()});store.transaction(()=>{for(const incoming of parsed.records){const merged=mergePrayerNote(store.get(incoming.kind,incoming.id),incoming);putChanged(store,incoming.kind,incoming.id,merged.data);}});prayer={status:'imported',records:parsed.records.length};}else prayer={status:'source-read-local-parsing-preserved',format:read.file.mimeType};}
    const windowState=schoolIngestionWindow({now:clock(),timeZone:config.timeZone??'America/Toronto'});let calendars={status:'deferred',reason:windowState.reason};
    if(initialSetup||windowState.allowed){progress('Reading all four selected calendars for the current term');const window=currentTermWindow({now:clock(),term:config.academicTerm});const read=await adapter.readSelectedCalendars(window);check(signal);calendars={status:'imported',...importCalendarSnapshot({store,config,calendars:read,window})};}
    let school={status:windowState.allowed?'snapshot-only':'deferred',reason:windowState.allowed?'School browser refresh is not enabled. Imported source snapshots remain available.':windowState.reason},portal=null,browserWork=null;
    if(config.schoolRuntimeEnabled===true&&(initialSetup||windowState.allowed)){
      const courses=store.list('course').filter(record=>schoolPath(record.data.source?.sourceUrl,/^\/d2l\/home\/\d+\/?$/,config)).sort((a,b)=>a.id.localeCompare(b.id));
      const materials=store.list('material').filter(record=>courses.some(course=>record.data.courseId===course.id)&&schoolPath(record.data.source?.sourceUrl,/^\/d2l\/le\/content\/\d+\/viewContent\/\d+\/View$/,config)&&!/quiz|acknowledg|survey|class list|student|schedule/i.test(record.data.title??'')).sort((a,b)=>a.id.localeCompare(b.id));
      const pendingMaterials=materials.filter(record=>record.data.source?.coverage!=='full-text'&&record.data.requiresDownload!==true&&!(record.data.browserRead?.lastPage&&record.data.browserRead.lastPage>=record.data.browserRead.totalPages)),hasPendingMaterial=pendingMaterials.length>0;
      browserWork=nextSchoolBrowserWork({now:clock(),timeZone:config.timeZone??'America/Toronto',windows:config.schoolBrowserWindows,hasPendingMaterial,initialSetup,attempted:key=>!!store.meta(key),backoff:Object.fromEntries(['learn','outlook','careers'].map(provider=>[provider,store.get('integration',provider)?.data.retryAfter]))});
      if(browserWork)store.meta(browserWork.key,{startedAt:clock(),provider:browserWork.provider,slot:browserWork.slot});
      if(browserWork?.provider==='learn'){
      progress('Reading school sources through the connected Chrome profile');const index=Number(store.meta('schoolRuntimeCourseCursor')??0),pending=browserWork.slot==='continuation'?pendingMaterials[index%pendingMaterials.length]:null,course=pending?courses.find(item=>item.id===pending.data.courseId):courses.length?courses[index%courses.length]:null,courseMaterials=materials.filter(record=>record.data.courseId===course?.id),material=pending??(courseMaterials.length?courseMaterials[Math.floor(index/Math.max(1,courses.length))%courseMaterials.length]:null);const defaultUrls=[schoolHome(config),...(course?[course.data.source.sourceUrl]:[]),...(material?[material.data.source.sourceUrl]:[])],sourceUrls=pending?defaultUrls:config.schoolRuntimeSourceUrls??defaultUrls;const trustedPolicies=Object.fromEntries(courses.map(record=>[record.data.source.sourceId,record.data.policy??{}]));
      try{const read=await collectSchool({directory:join(config.dataDir,'school-runtime',clock().replace(/[:.]/g,'-')),executable:config.aiExe,browserRuntime:config.schoolBrowserRuntime,sourceUrls,sourceReadHints:material&&sourceUrls.includes(material.data.source.sourceUrl)?[{url:material.data.source.sourceUrl,firstPage:material.data.browserRead?.nextPage??1}]:[],maxPages:3,now:clock(),initialSetup,timeZone:config.timeZone??'America/Toronto',trustedPolicies,signal,configuration:config});check(signal);if(read.status==='collected'){store.transaction(()=>{for(const incoming of read.records){const merged=mergeRuntimeCatalogue(store.get(incoming.kind,incoming.id),incoming);putChanged(store,incoming.kind,incoming.id,merged.data,'school-browser-source');}store.meta('schoolRuntimeCourseCursor',index+1);});school={status:read.coverage==='source-text'?'source-refreshed':'catalogue-refreshed',records:read.records.length,pages:read.pages.length,lastSuccess:clock(),coverage:read.coverage??'catalogue',contentObservations:read.contentObservations??[],sourceGaps:read.blockers??[],browserDependency:read.browserDependency};}else school={status:read.status,reason:read.reason};}catch(e){check(signal);school={status:'blocked',reason:'School browser refresh failed. Existing source records remain available.',errorCode:e.code??'school_runtime_failed'};}
       status(store,'learn',{...school,provider:'learn',title:'Example Institution LEARN',lastAttempt:clock(),retryAfter:school.status==='blocked'?new Date(Date.parse(clock())+3600000).toISOString():null});
      }else if(browserWork){
       const provider=browserWork.provider;progress(`Reading visible ${PORTALS[provider].title} previews`);
       try{const read=await collectPortal({provider,directory:join(config.dataDir,'portal-runtime',provider,clock().replace(/[:.]/g,'-')),executable:config.aiExe,browserRuntime:config.schoolBrowserRuntime,now:clock(),timeZone:config.timeZone??'America/Toronto',initialSetup,signal,configuration:config});check(signal);
        if(read.status==='collected')store.transaction(()=>{for(const incoming of read.records){const merged=mergePortalRecord(store.get(incoming.kind,incoming.id),incoming);putChanged(store,incoming.kind,incoming.id,merged.data,'school-portal-preview');}});
        const actionRequired=read.status==='blocked'?(read.gate==='commitment'?'Review the careers participation and rank/match commitments yourself. LifeOS will not accept them.':read.gate==='login'||read.gate==='mfa'?'Sign into this school provider and complete MFA normally in the connected Chrome profile.':'Keep the connected Chrome profile available and review this provider restriction.'):null;
        portal={provider,title:PORTALS[provider].title,status:read.status==='collected'?'preview-refreshed':read.status,coverage:'preview',records:read.records?.length??0,visibleEntries:read.visibleEntries??0,authenticatedDashboard:read.page?.authenticated===true,browserReadVerified:read.browserReadVerified===true,gate:read.gate??'none',reason:read.reason??null,actionRequired,lastAttempt:clock(),...(read.status==='collected'?{lastSuccess:clock()}:{}),retryAfter:read.status==='blocked'?new Date(Date.parse(clock())+(['commitment','login','mfa','policy'].includes(read.gate)?86400000:3600000)).toISOString():null};
       }catch(e){check(signal);portal={provider,title:PORTALS[provider].title,status:'blocked',reason:'Portal read failed. Previous source records remain available.',errorCode:e.code??'portal_runtime_failed',lastAttempt:clock(),retryAfter:new Date(Date.parse(clock())+3600000).toISOString()};}
       status(store,provider,portal);school={...store.get('integration','school')?.data,status:'deferred',reason:`This browser turn checked ${PORTALS[provider].title}. Existing LEARN records remain available.`};
      }else school={...store.get('integration','school')?.data,status:'deferred',reason:'No bounded browser read is scheduled. Existing source records remain available.'};
    }
    if(!config.schoolRuntimeEnabled||browserWork?.provider==='learn'||!windowState.allowed&&!initialSetup)status(store,'school',{...school,lastAttempt:clock(),actionRequired:school.status==='blocked'?'Keep AI Desktop and the signed-in Chrome profile available. Complete school login or MFA normally if requested.':null});status(store,'source-sync',{status:portal?.status==='preview-refreshed'||['catalogue-refreshed','source-refreshed'].includes(school.status)?'ready':portal||school.status==='deferred'?'partial':'snapshot-only',lastSuccess:clock(),journal,prayer,calendars,school,portal});return {identityVerified:true,seed,journal,prayer,calendars,school,portal};
  }
  async function devotionalArchive({job,signal,progress}){
    const date=job.payload?.date;if(!validDate(date))throw error('A devotional date is required','invalid_input');let item=store.get('devotional',date);if(!item)throw error('Devotional entry no longer exists','record_missing');
    if(item.data.imported||item.data.archiveEligible===false||item.data.complete!==true||item.data.points?.length!==7||item.data.points.some(p=>typeof p!=='string'||!p.trim()))return {status:'not-eligible',preservedExistingArchive:true};
    if(job.payload.version&&job.payload.version!==item.version)return {status:'superseded',preserved:true};
    const target=devotionalDigest(item.data),revision=item.version,oldState=store.get('devotional-archive-state',date)?.data;
    if(oldState?.archiveStatus==='archived'&&oldState.targetHash===target&&oldState.targetVersion===revision)return {status:'archived',duplicate:true,documentId:oldState.archiveDocumentId};
    const archiveState={date,targetHash:target,targetVersion:revision,archiveStatus:'processing',archiveError:null};putChanged(store,'devotional-archive-state',date,archiveState,'devotional-archive');
    try{check(signal);const adapter=await google();progress('Archiving the completed devotional entry');const result=await adapter.syncManagedEntry({documentId:sourceId(config.sourceIds?.devotional_journal),entryId:`devotional:${date}`,text:devotionalText(item.data),tabId:config.googleJournalTabId,backupParentId:folders(config).backups});check(signal);if(!result.verified)throw error('Devotional archive read-back did not verify','verification_failed');
      item=store.get('devotional',date);if(item.version!==revision||devotionalDigest(item.data)!==target||item.data.complete!==true)return {status:'superseded-after-archive',preserved:true};
      putChanged(store,'devotional-archive-state',date,{...archiveState,archiveStatus:'archived',archivedAt:clock(),archiveDocumentId:result.documentId,archiveNamedRangeId:result.namedRangeId,archiveReadbackHash:result.sha256},'devotional-archive');return {status:'archived',verified:true,documentId:result.documentId,duplicate:result.duplicate===true};
    }catch(e){item=store.get('devotional',date);if(item?.version===revision&&devotionalDigest(item.data)===target)putChanged(store,'devotional-archive-state',date,{...archiveState,archiveStatus:'retry-needed',archiveError:e.code??'archive_failed'},'devotional-archive');throw e;}
  }
  async function prayerProcess({job,signal,progress}){
    const sessionId=safeId(job.payload?.sessionId);let item=store.get('prayer-session',sessionId);if(!item)throw error('Prayer capture is unavailable','record_missing');
    const archiveOnly=job.payload.archiveOnly===true;let result,reviewVersion=null;
    if(archiveOnly){reviewVersion=job.payload.reviewVersion;if(!Number.isInteger(reviewVersion)||item.data.reviewVersion!==reviewVersion)return {status:'superseded-review',rawRetention:'retain'};if(item.data.humanReviewed!==true)throw error('Explicit transcript review is required','review_required');result=reviewedPrayer(item.data);}
    else if(item.data.reviewVersion)return {status:'review-preserved',rawRetention:item.data.rawRetention??'retain'};
    else if(item.data.processingResult)result=item.data.processingResult;
    else{
      check(signal);const chunks=store.db.prepare('SELECT * FROM chunks WHERE session_id=? ORDER BY chunk_index').all(sessionId);const outputRoot=join(config.dataDir,'prayer-artifacts');await mkdir(outputRoot,{recursive:true});
      const transcription=config.transcription??{};if(!transcription.ffmpegPath||!transcription.pythonPath||!transcription.modelPath)throw error('Configure the tested local transcription programs','configuration_missing');
      putChanged(store,'prayer-session',sessionId,{...item.data,processingStatus:'transcribing',rawRetention:'retain'},'prayer-process');progress('Transcribing the saved recording locally');
      result=await processAudio({sessionId,chunks,storageRoot:config.dataDir,outputRoot,...transcription,sectionMarkers:item.data.sections??[],plannedNotes:store.list('prayer-note'),signal});check(signal);
      item=store.get('prayer-session',sessionId);if(item.data.reviewVersion)return {status:'review-preserved',rawRetention:'retain'};
      putChanged(store,'prayer-session',sessionId,{...item.data,processingResult:result,cleanedTranscript:result.cleanedTranscript,transcriptText:result.cleanedTranscript,sectionsStructured:result.sections,qualityFlags:result.qualityFlags,humanReviewed:false,seriousUncertainty:true,processingStatus:'transcribed-needs-review',rawRetention:'retain'},'prayer-process');
    }
    item=store.get('prayer-session',sessionId);const expected=archiveOnly?reviewedDigest(item.data):hash(result.cleanedTranscript),stamp=hash([sessionId,expected]).slice(0,40),artifactRoot=join(config.dataDir,'prayer-artifacts',sessionId,stamp);await mkdir(artifactRoot,{recursive:true});
    const transcript=result.cleanedTranscript??'',journal=renderPrayerJournal(result).replace('Machine transcript, pending correction. Prayer completion is recorded separately.',archiveOnly?'Owner-reviewed transcript. Prayer completion is recorded separately.':'Machine transcript, pending correction. Prayer completion is recorded separately.');
    const artifacts={transcript:await saveImmutable(config,join(artifactRoot,'transcript.txt'),transcript),journal:await saveImmutable(config,join(artifactRoot,'journal.md'),journal)};
    const stillCurrent=()=>{const current=store.get('prayer-session',sessionId);return archiveOnly?current.data.reviewVersion===reviewVersion&&reviewedDigest(current.data)===expected:!current.data.reviewVersion&&hash(current.data.cleanedTranscript??'')===expected;};
    try{
      check(signal);const adapter=await google(),destination=folders(config);if(!destination.transcripts||!destination.archives)throw error('Private prayer archive folders are not configured','configuration_missing');
      for(const [name,text,parentId] of [['transcript',transcript,destination.transcripts],['journal',journal,destination.prayerJournal??destination.archives]]){
        if(!stillCurrent())return {status:'superseded-review',rawRetention:'retain'};check(signal);progress(`Saving the private prayer ${name}`);
        const uploaded=await adapter.uploadText({key:`prayer:${sessionId}:${stamp}:${name}`,name:`Prayer ${sessionId} ${name}${name==='journal'?'.md':'.txt'}`,text,parentId});
        if(!uploaded.verified||uploaded.sha256!==artifacts[name].sha256)throw error('Prayer archive read-back did not match','verification_failed');artifacts[name]={...artifacts[name],archiveId:uploaded.file.id,readbackSha256:uploaded.sha256};
      }
      if(!stillCurrent())return {status:'superseded-review',rawRetention:'retain'};check(signal);
      const document=await adapter.createPrivateDocument({key:`prayer-journal:${sessionId}`,name:`LifeOS prayer journal ${sessionId}`,parentId:destination.prayerJournal??destination.archives});
      const synced=await adapter.syncManagedEntry({documentId:document.file?.id??document.id,entryId:`prayer:${sessionId}`,text:journal,backupParentId:destination.backups});
      if(!synced.verified)throw error('Private prayer journal read-back did not verify','verification_failed');check(signal);if(!stillCurrent())return {status:'superseded-review',rawRetention:'retain'};
      item=store.get('prayer-session',sessionId);const retention=prayerRetention({createdByLifeOS:item.data.createdByLifeOS===true,processingComplete:true,humanReviewed:archiveOnly&&result.humanReviewed,seriousUncertainty:!archiveOnly||result.seriousUncertainty,artifacts});
      putChanged(store,'prayer-session',sessionId,{...item.data,artifacts,archiveStatus:'archived',archiveReadbackAt:clock(),archiveReviewVersion:reviewVersion,archiveContentHash:expected,archiveDocumentId:synced.documentId,processingStatus:archiveOnly?'reviewed-and-archived':'transcribed-needs-review',rawRetention:retention.rawRetention,retentionReasons:retention.reasons},'prayer-process');
      // Deletion is optional, narrow, and enabled only in private server configuration after a reviewed archive.
      if(retention.mayDeleteLifeOSRaw&&config.prayerRawCleanupEnabled===true&&stillCurrent()){
        const chunks=store.db.prepare('SELECT * FROM chunks WHERE session_id=? ORDER BY chunk_index').all(sessionId),base=realpathSync(config.dataDir),captureRoot=join(base,'uploads',sessionId);
        const authorization={reviewVersion,contentHash:expected,transcriptSha256:artifacts.transcript.sha256,journalSha256:artifacts.journal.sha256,chunks:chunks.map(c=>({index:c.chunk_index,sha256:c.sha256,size:c.size}))};
        item=store.get('prayer-session',sessionId);const previousAuthorization=item.data.rawCleanupAuthorization,resuming=previousAuthorization&&same({...previousAuthorization,derivedAudio:undefined},authorization),derivedAudio=[];
        // This durable intent survives a crash between a file deletion and the final database update.
        for(const chunk of chunks){if(relative(captureRoot,chunk.path)!==`${chunk.chunk_index}.chunk`)throw error('Raw cleanup found an unexpected capture path; retained','cleanup_denied');if(!existsSync(chunk.path)){if(!resuming)throw error('A raw capture file is unexpectedly missing','cleanup_denied');continue;}const file=realpathSync(chunk.path);if(relative(captureRoot,file)!==`${chunk.chunk_index}.chunk`||hash(readFileSync(file))!==chunk.sha256||statSync(file).size!==chunk.size)throw error('Raw cleanup found an unexpected capture file; retained','cleanup_denied');}
        const processing=item.data.processingResult,originalTranscript=processing?.artifacts?.transcript?.path;
        if(originalTranscript){
          const directory=dirname(await privatePath(config.dataDir,originalTranscript)),parent=await realpath(join(base,'prayer-artifacts'));
          if(dirname(directory)!==parent||! /^[a-f0-9]{64}$/.test(processing.sourceFingerprint??'')||![prayerProcessingPrefix(sessionId,processing.sourceFingerprint),`${sessionId}-${processing.sourceFingerprint.slice(0,16)}-`].some(prefix=>basename(directory).startsWith(prefix)))throw error('Derived audio location is not a verified LifeOS processing directory','cleanup_denied');
          for(const name of ['recording.media','decoded.wav']){
            const path=join(directory,name),relativePath=relative(base,path);if(!existsSync(path)){const prior=previousAuthorization?.derivedAudio?.find(a=>a.relativePath===relativePath);if(!resuming||!prior)throw error('A derived audio file is unexpectedly missing','cleanup_denied');derivedAudio.push(prior);continue;}
            const file=await privatePath(config.dataDir,path);if(dirname(file)!==directory||basename(file)!==name)throw error('Derived audio escaped its processing directory','cleanup_denied');const info=await stat(file),sha256=await fileSha256(file);derivedAudio.push({relativePath,sha256,size:info.size,mtimeMs:info.mtimeMs,ctimeMs:info.ctimeMs});
          }
        }
        authorization.derivedAudio=derivedAudio;
        if(!stillCurrent())return {status:'superseded-review',rawRetention:'retain'};putChanged(store,'prayer-session',sessionId,{...item.data,rawCleanupAuthorization:authorization,rawRetention:'cleanup-authorized'},'reviewed-prayer-cleanup-authorization');
        // Hold the SQLite write lock and perform synchronous narrow deletions so a concurrent review cannot interleave.
        store.transaction(()=>{check(signal);if(!stillCurrent())throw error('Transcript review changed before cleanup','review_changed');for(const chunk of chunks){if(!existsSync(chunk.path))continue;const file=realpathSync(chunk.path);if(relative(captureRoot,file)!==`${chunk.chunk_index}.chunk`||hash(readFileSync(file))!==chunk.sha256||statSync(file).size!==chunk.size)throw error('Capture changed before cleanup','cleanup_denied');unlinkSync(file);}for(const audio of derivedAudio){const path=join(base,audio.relativePath);if(!existsSync(path))continue;const file=realpathSync(path),info=statSync(file);if(file!==path||info.size!==audio.size||info.mtimeMs!==audio.mtimeMs||info.ctimeMs!==audio.ctimeMs)throw error('Derived audio changed before cleanup','cleanup_denied');unlinkSync(file);}item=store.get('prayer-session',sessionId);putChanged(store,'prayer-session',sessionId,{...item.data,rawRetention:'deleted',rawDeletedAt:clock(),rawDeletionEvidence:authorization},'reviewed-prayer-raw-cleanup');});
      }
      return {status:'archived',verified:true,reviewVersion,rawRetention:store.get('prayer-session',sessionId).data.rawRetention};
    }catch(e){item=store.get('prayer-session',sessionId);if(stillCurrent())putChanged(store,'prayer-session',sessionId,{...item.data,artifacts,archiveStatus:'retry-needed',archiveError:e.code??'archive_failed',rawRetention:'retain'},'prayer-process');throw e;}
  }
  async function runNow({job,signal,progress=()=>{},initialSetup=false}){
    check(signal);try{
      if(job.type==='source-sync')return await sourceSync({job,signal,progress,initialSetup});
      if(job.type==='devotional-archive')return await devotionalArchive({job,signal,progress});
      if(job.type==='prayer-process')return await prayerProcess({job,signal,progress});
      if(job.type==='backup'){
        progress('Creating a consistent local backup');const backup=await createLocalBackup({store,config,id:safeId(job.id),signal});status(store,'backup',{status:'local-verified',localPath:backup.directory,localVerifiedAt:clock()});
        if(config.environment!=='production'||config.integrationsEnabled!==true)return {status:'local-only',integrity:'ok',cloudVerified:false};
        const archived=await archiveBackup({backup,adapter:await google(),parentId:folders(config).backups,signal,progress});status(store,'backup',{status:'ready',lastSuccess:clock(),...archived});return {status:'verified',integrity:'ok',cloudVerified:true,...archived};
      }
      throw error('Unsupported integration job','invalid_job');
    }catch(e){if(['authentication_required','identity_mismatch','wrong_account','credential_storage_failed'].includes(e.code))e.code='auth_required';status(store,job.type,{status:e.code==='cancelled'?'stopped':e.code==='auth_required'?'authentication-required':'retry-needed',lastAttempt:clock(),errorCode:e.code??'integration_failed'});throw e;}
  }
  return {run(input){const operation=tail.then(()=>runNow(input));tail=operation.catch(()=>{});return operation;},sourceSyncForInitialSetup:input=>{const operation=tail.then(()=>sourceSync({...input,progress:input?.progress??(()=>{}),initialSetup:true}));tail=operation.catch(()=>{});return operation;}};
}

const runners=new WeakMap();
/** One serialized adapter instance per store. The web payload cannot grant setup authority or select destinations. */
export function runIntegrationJob({store,config,...input}){let runner=runners.get(store);if(!runner){runner=createIntegrationRunner({store,config});runners.set(store,runner);}return runner.run({...input,initialSetup:false});}
