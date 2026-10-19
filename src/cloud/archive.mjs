import {privateObject} from './objects.mjs';
import {verifyBackupRevision} from './backup-revision.mjs';
import {journalStructure,planCanonicalEntry} from '../integrations/canonical-journal.mjs';
import {BIBLE_BOOKS} from '../../public/bible.js';
import {createGoogleAdapter,GoogleIntegrationError} from '../integrations/google.mjs';import {googleToken,googleFetch,privateFile} from './google.mjs';import {AppError} from '../shared/errors.mjs';import {devotionalDigest} from '../shared/application.mjs';
import {selectedPassage} from '../../public/bible.js';
export function devotionalArchiveText(data){const p=selectedPassage(data.bookId,data.chapter,data.chapterEnd??data.chapter);return p.passage+'\n'+data.points.map((answer,i)=>`${i+1}. ${answer}`).join('\n')+'\n';}
export async function cloudArchiveAdapter(store,env,config){
 if(env.ENVIRONMENT!=='production'&&!(env.ENVIRONMENT==='beta'&&config.googleJournalTestDocumentId))throw new AppError('Live journal synchronization remains disabled in beta',403);
 let record=await store.get('provider-state','google');
 const stateStorage={read:async()=>structuredClone(record?.data??{resources:{},entries:{},backups:{},probes:{},pending:{}}),write:async value=>{const now=new Date().toISOString(),after={kind:'provider-state',id:'google',data:structuredClone(value),version:(record?.version??0)+1,createdAt:record?.createdAt??now,updatedAt:now};await store.commit({id:crypto.randomUUID(),fingerprint:{provider:'google',revision:after.version},changes:[{kind:after.kind,id:after.id,before:record,after,auditId:crypto.randomUUID(),actor:'cloud-google-state'}],result:{saved:true}});record=after;}};
 let count=0;
 const authClient={request:async options=>{
  if(++count>35)throw new AppError('Archive batch reached its request budget',503,'batch_budget');
  const url=new URL(options.url);if(url.protocol!=='https:'||!['www.googleapis.com','docs.googleapis.com','openidconnect.googleapis.com'].includes(url.hostname))throw new AppError('Provider destination denied',403);
  for(const [key,value]of Object.entries(options.params??{}))if(value!==undefined)url.searchParams.set(key,String(value));
  const headers=new Headers(options.headers);headers.set('Authorization','Bearer '+await googleToken(env));let body=options.data;if(body&&typeof body==='object'&&!(body instanceof Uint8Array)){body=JSON.stringify(body);headers.set('Content-Type','application/json');}
  const operation=url.hostname==='docs.googleapis.com'?'document read/write':url.pathname.endsWith('/copy')?'backup copy':'Drive metadata';let response;try{response=await fetch(url,{method:options.method??'GET',headers,body,redirect:'manual',signal:AbortSignal.timeout(45000)});}catch{throw new GoogleIntegrationError('Google '+operation+' timed out or could not connect. Saved writing is safe.','google_unavailable');}if(!response.ok)throw new GoogleIntegrationError('Google '+operation+' returned HTTP '+response.status+'. Saved writing is safe.','google_failed',response.status);
  return {status:response.status,headers:response.headers,data:options.responseType==='arraybuffer'?new Uint8Array(await response.arrayBuffer()):response.status===204?{}:await response.json()};
 }};
 const trustedReadStorage={write:async(document,inspection)=>{const text=JSON.stringify(document),bytes=new TextEncoder().encode(text).length;if(bytes>4*1024*1024)throw new AppError('This source exceeds the bounded cloud document read',413,'document_batch_limit');const parts=[];for(let i=0;i<text.length;i+=400000)parts.push(text.slice(i,i+400000));await store.db.batch([store.sql('DELETE FROM trusted_document_parts WHERE document_id=?',document.documentId),...parts.map((part,index)=>store.sql('INSERT INTO trusted_document_parts VALUES(?,?,?,?)',document.documentId,document.revisionId,index,part)),store.sql('INSERT INTO trusted_document_reads VALUES(?,?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET revision_id=excluded.revision_id,content=excluded.content,fingerprint=excluded.fingerprint,read_at=excluded.read_at',document.documentId,document.revisionId,JSON.stringify({format:'bounded-json-parts-v1',parts:parts.length,bytes}),inspection.fingerprint,new Date().toISOString())]);return 'cloud-trusted-read:'+document.documentId+':'+document.revisionId;}};
 const verifyExistingBackup=async old=>{if(!old.verified||!old.verifiedDriveVersion)throw new AppError('The original archive backup needs its migration verification',503,'backup_verification_required');await privateFile(env,old.fileId,config.driveFolders.backups);const cached=await store.sql('SELECT revision_id FROM trusted_document_reads WHERE document_id=?',old.fileId).first();return verifyBackupRevision({backup:old,cachedRevision:cached?.revision_id,readDrive:async()=>await(await googleFetch(env,`https://www.googleapis.com/drive/v3/files/${old.fileId}?fields=id,version`)).json(),readDocumentRevision:async()=>await(await googleFetch(env,`https://docs.googleapis.com/v1/documents/${old.fileId}?fields=revisionId`)).json()});};
 // Edits remain exact named-range operations with a required Google revision. Styles and other native structures are never reconstructed.
 const documentFields='documentId,revisionId,tabs(tabProperties,documentTab(body(content(startIndex,endIndex,paragraph,table,sectionBreak)),namedRanges,namedStyles),childTabs)';
 const captureBackupVersion=async id=>{await privateFile(env,id,config.driveFolders.backups);const file=await(await googleFetch(env,`https://www.googleapis.com/drive/v3/files/${id}?fields=id,version`)).json();if(!/^\d+$/.test(String(file.version)))throw new AppError('Backup version unavailable',503);return {verifiedDriveVersion:String(file.version)};};
 return createGoogleAdapter({...config,environment:'production',integrationsEnabled:true,dataDir:'/cloud-state',googleTokenFile:null},{authClient,stateStorage,trustedReadStorage,verifyExistingBackup,captureBackupVersion,documentFields});
}
export async function archiveDevotional({store,env,config,job}){
 const candidate=await store.get('devotional',job.payload.entryId??job.payload.date);if(candidate?.data.type==='custom')return archiveCustomDevotional({store,env,config,job,item:candidate});
 const blocked=await store.meta('devotional-archive-blocked');if(blocked)throw new AppError(blocked.message,503,'archive_paused');
 const item=await store.get('devotional',job.payload.entryId??job.payload.date);if(!item||!item.data.archiveRequested||item.data.imported||item.data.archiveEligible===false||item.version!==job.payload.version)return {status:'superseded',preserved:true};
 const before=await store.get('devotional-archive-state',item.id),target=devotionalDigest(item.data);if(before?.data.targetHash===target&&before.data.archiveStatus==='archived')return {status:'archived',duplicate:true};
 const adapter=await cloudArchiveAdapter(store,env,config);const text=devotionalArchiveText(item.data);
 const destination=env.ENVIRONMENT==='beta'?config.googleJournalTestDocumentId:typeof config.sourceIds.devotional_journal==='string'?config.sourceIds.devotional_journal:config.sourceIds.devotional_journal.id;
 const saved=await adapter.syncCanonicalEntry({documentId:destination,entryId:`devotional:${item.id}`,allowAdditionalEntry:!/^\d{4}-\d{2}-\d{2}$/.test(item.id),bookId:item.data.bookId,chapter:item.data.chapter,chapterEnd:item.data.chapterEnd,points:item.data.points,tabId:config.googleJournalTabId,backupParentId:config.driveFolders.backups});if(!saved.verified)throw new AppError('Archive verification failed',503);
 const after={kind:'devotional-archive-state',id:item.id,version:(before?.version??0)+1,createdAt:before?.createdAt??new Date().toISOString(),updatedAt:new Date().toISOString(),data:{date:item.data.date,entryId:item.id,targetHash:target,targetVersion:item.version,archiveStatus:'archived',archivedAt:new Date().toISOString(),archiveDocumentId:saved.documentId,archiveNamedRangeId:saved.namedRangeId,archiveReadbackHash:saved.sha256}};
 await store.commit({id:'archive-'+job.id,fingerprint:{jobId:job.id},reads:[{kind:'devotional',id:item.id,version:item.version}],changes:[{kind:after.kind,id:after.id,before,after,auditId:crypto.randomUUID(),actor:'cloud-archive'}],result:{archived:true}});return {status:'archived',verified:true};
}

export async function prepareDevotionalArchive({store,env,config}){
 if(env.ENVIRONMENT!=='production')throw new AppError('Preparation is production-only',403);
 const adapter=await cloudArchiveAdapter(store,env,config),documentId=typeof config.sourceIds.devotional_journal==='string'?config.sourceIds.devotional_journal:config.sourceIds.devotional_journal.id;
 const backup=await adapter.backupDocument({documentId,parentId:config.driveFolders.backups});
 const read=await adapter.trustedReadDocument(documentId),tab=read.document.tabs?.[0]?.documentTab;
 const structure=journalStructure(tab),missing=BIBLE_BOOKS.find(book=>!structure.sections.some(section=>section.book.canonicalId===book.canonicalId));
 if(missing)planCanonicalEntry({tab,bookId:missing.canonicalId,chapter:1,points:Array(7).fill('Read-only structural validation')});
 return {prepared:true,backupVerified:backup.verified,canonicalSections:structure.sections.length,sourceUnchanged:true};
}

export async function archiveCustomDevotional({store,env,config,job,item}){
 if(!item.data.archiveRequested||item.version!==job.payload.version)return {status:'superseded',preserved:true};
 const target=devotionalDigest(item.data),before=await store.get('devotional-archive-state',item.id);if(before?.data.targetHash===target&&before.data.archiveStatus==='archived')return {status:'archived',duplicate:true};
 const saved=await privateObject({store,env,folder:config.driveFolders.archives,key:'custom-devotional:'+item.id+':'+target,name:'Devotional '+item.data.date+' '+item.id+'.txt',mime:'text/plain',content:item.data.customText});
 const now=new Date().toISOString(),after={kind:'devotional-archive-state',id:item.id,version:(before?.version??0)+1,createdAt:before?.createdAt??now,updatedAt:now,data:{entryId:item.id,date:item.data.date,targetHash:target,targetVersion:item.version,archiveStatus:'archived',archivedAt:now,archiveFileId:saved.archiveId,archiveReadbackHash:saved.sha256,archiveDestination:'private-drive'}};
 await store.commit({id:'archive-'+job.id,fingerprint:{jobId:job.id},reads:[{kind:'devotional',id:item.id,version:item.version}],changes:[{kind:after.kind,id:after.id,before,after,auditId:crypto.randomUUID(),actor:'custom-devotional-archive'}],result:{archived:true}});return {status:'archived',verified:true,destination:'private-drive'};
}
