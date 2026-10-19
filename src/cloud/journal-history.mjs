import {reconcileHistoricalEntry,classifyJournalAdditions} from '../integrations/reconcile-journal.mjs';
export async function reconcileJournalSlice({store,job}){
 const config=await store.meta('journal-history-config');if(!config?.sourceHash)throw Error('Historical source cache is not staged');
 const key='journal-history-cursor',prior=await store.meta(key),cursor=prior?.sourceHash===config.sourceHash?prior:{sourceHash:config.sourceHash,lastId:'',processed:0,entriesProcessed:0,unresolvedAuthors:0,unresolvedDates:0,totalRecords:config.totalRecords,totalEntries:config.totalEntries,batches:0};if(cursor.complete)return {complete:true,...cursor};
 const rows=(await store.sql("SELECT * FROM records WHERE kind='devotional-import' AND json_extract(data,'$.sourceHash')=? AND id>? ORDER BY id LIMIT 5",config.sourceHash,cursor.lastId).all()).results,additions=classifyJournalAdditions(config.additions??[]),changes=[],now=new Date().toISOString();
 for(const row of rows){const before={kind:row.kind,id:row.id,data:JSON.parse(row.data),version:row.version,createdAt:row.created_at,updatedAt:row.updated_at};const metadata=reconcileHistoricalEntry(before.data,{addition:additions[row.id],importedAt:before.createdAt,revisionMetadataCount:config.revisions.length,sourceHash:config.sourceHash});
  if(JSON.stringify(before.data.historyReconciliation)!==JSON.stringify(metadata))changes.push({kind:row.kind,id:row.id,before,after:{...before,version:before.version+1,updatedAt:now,data:{...before.data,historyReconciliation:metadata}},auditId:crypto.randomUUID(),actor:'deterministic-journal-history'});
  cursor.processed++;if(metadata.classification!=='source-note'){cursor.entriesProcessed++;if(!metadata.author)cursor.unresolvedAuthors++;if(!metadata.devotionalDate)cursor.unresolvedDates++;}cursor.lastId=row.id;
 }
 cursor.batches++;cursor.updatedAt=now;cursor.complete=rows.length<5||cursor.processed>=cursor.totalRecords;cursor.mode=cursor.complete?'complete-with-unresolved-evidence':'background-processing';cursor.modelCalls=0;
 await store.commit({id:'journal-history-'+job.id+'-'+cursor.lastId,fingerprint:{sourceHash:config.sourceHash,lastId:cursor.lastId},changes,result:cursor,extra:[store.sql('UPDATE jobs SET priority=25 WHERE id=?',job.id),store.sql("INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",key,JSON.stringify(cursor))]});return cursor;
}
