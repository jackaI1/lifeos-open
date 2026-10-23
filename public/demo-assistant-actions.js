import {demoAssistantOptions,isDemoAssistant} from './demo-assistant.js';
/** Only the two explicit fictional schedule examples may auto-apply their own job's validated changes. */
export async function applyDemoExampleChanges({session,example,jobId,threadId,request}){
 const operation=example?.id==='today-add'?'calendar-create':example?.id==='today-move'?'schedule-adjust':null;
 if(!isDemoAssistant(session)||!operation||!demoAssistantOptions('today').some(option=>option.id===example.id&&option.message===example.message)||typeof jobId!=='string'||!jobId||typeof threadId!=='string'||!threadId)return 0;
 const data=await request('/api/assistant/threads/'+encodeURIComponent(threadId));let applied=0;
 for(const record of data.proposals??[]){
  if(record.data.threadId!==threadId||record.data.jobId!==jobId||record.data.status!=='proposed'||record.data.proposal?.operation!==operation)continue;
  const result=await request('/api/assistant/proposals/'+encodeURIComponent(record.id)+'/apply',{method:'POST',body:{version:record.version,mutationId:'demo-example-apply-'+record.id}});
  if(result.pending)throw Error(result.reason||'This example change is not yet saved. Your existing schedule is kept.');applied++;
 }
 return applied;
}
export function demoAssistantDisplayText(message,proposals){
 if(message.mock!==true)return message.text;
 const changes=(message.proposalIds??[]).map(id=>proposals.find(p=>p.id===id)).filter(Boolean);if(!changes.length)return message.text;
 if(changes.every(record=>record.data.status==='undone'))return 'This local demo change was undone.';
 if(changes.every(record=>record.data.status==='applied')&&changes.length===1){const record=changes[0],title=record.data.targetTitle||'The item';
  if(record.data.proposal.operation==='calendar-create')return `“${title}” was added to your local demo schedule. You can undo this change below.`;
  if(record.data.proposal.operation==='schedule-adjust')return `“${title}” was moved in your local demo schedule. The updated times are below, with Undo if you want to put it back.`;
 }
 return message.text;
}
