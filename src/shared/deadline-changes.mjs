export function recordDeadlineChange(before,after,at){
 if(!before)return after;
 const previous=before.dueAt||before.dueDate||null,current=after.dueAt||after.dueDate||null;
 if(previous===current)return after;
 const changes=[...(before.deadlineChanges??[])],source=after.interpretationEvidence??after.source??{};
 changes.push({id:crypto.randomUUID(),previous,current,at,sourceUrl:after.sourceUrl??source.sourceUrl??after.sourceUrls?.[0]??null,sourceId:source.sourceId??null,evidence:source.quote??after.deadlineEvidence??null,reviewedAt:null});
 return {...after,deadlineChanges:changes};
}
