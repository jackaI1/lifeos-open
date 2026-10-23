import {financeSnapshot} from '../cloud/finances.mjs';
import {CloudStore} from '../cloud/store.mjs';
import {demoAssistantAnswer} from '../../public/demo-assistant.js';
import {buildToday,normalizeDomainSettings,addDays,availableIntervals} from '../domain/index.mjs';
import {lifeosDay} from '../../public/lifeos-day.js';
import {assistantContext,validateAssistantProposal} from '../shared/assistant-contract.mjs';
import {projectReplySchema} from '../shared/project-artifact.mjs';
import {studySchema,studyPrompt,validateStudyResult} from '../shared/lecture-study-contract.mjs';
import {briefSchema,validateBrief} from '../shared/assignment-brief.mjs';
import {savedProjectPreparation} from '../cloud/project-artifacts.mjs';
import {projectPreparationContext} from '../cloud/project-preparation.mjs';
import {validateCookingHelpResult} from '../shared/cooking-help-contract.mjs';
import type {WorkspaceDatabase} from './database.ts';
import {createHash,randomUUID} from 'node:crypto';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
import {chatCompletion} from '../shared/llm.mjs';
export async function assistantReply(scope:string,message:string,env:Record<string,any>,context:string='',model?:string,images:string[]=[]){return chatCompletion({scope,message,env,context,model,images});}
function authoredCookingAnswer(intent:any){
 const explanations:Record<string,string>={
  'Explain this preparation step using the selected saved recipe excerpt.':'Follow the preparation step alongside the exact saved recipe excerpt below. Keep its stated quantities and timing. This example does not fill in omitted temperatures, ingredients, or doneness checks.',
  'What should I check in the selected saved recipe excerpt before doing this preparation step?':'Before beginning, check the selected recipe for the ingredients, equipment, quantities, timing, and any safety instructions this step needs. If a detail is missing, consult the original recipe rather than guessing.',
  'Help me review the selected saved recipe instructions for this preparation step without inventing missing details.':'Compare your preparation step with the saved recipe quoted below. Preserve its wording and quantities, and resolve any missing information before continuing. This example cannot verify whether food is safe or done.'
 };
 const explanation=explanations[intent?.question];if(!explanation)return null;
 const {start,end}=intent.source.range;
 return validateCookingHelpResult({schema:1,explanation,sourceExcerpts:[{field:'recipe',start,end,text:intent.source.recipe.slice(start,end)},...(intent.selectedStep.text?[{field:'selectedStep',start:0,end:intent.selectedStep.text.length,text:intent.selectedStep.text}]:[])],questions:['Does the original recipe supply everything you need for this step?'],suggestedStepText:null},intent);
}
export function demoAvailableSlots(days:any[],now:string){
 return days.flatMap(d=>{
  const occupied=d.timeline.filter((e:any)=>e.start&&e.end&&Date.parse(e.end)>Date.parse(e.start)&&(e.corrected||!['school','rest','free','personal','discretionary','project'].includes(e.kind))).map((e:any)=>({start:e.start,end:e.end}));
  return [...d.availability.academicBlocks,...d.availability.discretionaryBlocks].filter(s=>Date.parse(s.end)>Math.max(Date.parse(s.start),Date.parse(now))).flatMap(s=>availableIntervals({start:new Date(Math.max(Date.parse(s.start),Date.parse(now))).toISOString(),end:s.end,busy:occupied}).map(slot=>({...slot,day:d.date}))).filter(s=>Date.parse(s.end)>Date.parse(s.start));
 }).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
}
export async function drainJobs(db:WorkspaceDatabase,env:Record<string,any>){
 const put=async(kind:string,id:string,data:any)=>{const old=await db.prepare('SELECT * FROM records WHERE kind=? AND id=?').bind(kind,id).first(),now=new Date().toISOString();await db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,version=excluded.version,updated_at=excluded.updated_at').bind(kind,id,JSON.stringify(data),(old?.version??0)+1,old?.created_at??now,now).run();};
 const get=async(kind:string,id:string)=>{const row=await db.prepare('SELECT data FROM records WHERE kind=? AND id=?').bind(kind,id).first();return row?JSON.parse(row.data):null;};
 const jobs=(await db.prepare("SELECT * FROM jobs WHERE status='queued' AND available_at<=? ORDER BY priority,created_at LIMIT 20").bind(Date.now()).all()).results;
 for(const job of jobs){
  const p=JSON.parse(job.payload);let reply='This request completed in your local workspace.';
  try{
   if(job.type==='assistant'||job.type==='support'){
    const message=await get('support-message',p.messageId);const thread=await get('support-thread',p.threadId);
    const scope=thread?.scope??p.scope??'support';
    const contextKinds=scope==='lecture'?['course','material','learning-note','private-note','lecture-transcript']:scope==='academics'?['course','task','calendar-event','learning-note']:scope==='today'?['project','task','calendar-event']:scope==='finances'?['finance-budget','finance-transaction']:[];
    const contextRows=contextKinds.length?(await db.prepare('SELECT kind,id,data FROM records WHERE kind IN ('+contextKinds.map(()=>'?').join(',')+') ORDER BY kind,id LIMIT 60').bind(...contextKinds).all()).results:[];
    const context=JSON.stringify(contextRows.map(r=>({kind:r.kind,id:r.id,...JSON.parse(r.data)})),(key,value)=>typeof value==='string'?value.slice(0,1200):['image','imageData','document','raw','bodyHtml'].includes(key)?undefined:value);
    const timezone=(await get('settings','preferences'))?.timezone??'America/Toronto';
    const prepared=thread?.preparationOnly&&env.LLM_MODE==='real'?JSON.parse(await chatCompletion({env,scope:'project',message:message?.text??p.message??'',context:JSON.stringify(thread.preparationSnapshot),schema:projectReplySchema,model:p.model??thread?.model})):null;
    reply=prepared?.reply??await assistantReply(thread?.preparationOnly?'project':scope,message?.text??p.message??'',{...env,LIFEOS_TIMEZONE:timezone},thread?.preparationOnly?JSON.stringify(thread.preparationSnapshot):context,p.model??thread?.model,scope==='lecture'?[message?.note?.image,message?.slide?.image].filter(Boolean):[]);
    let demoProposals:string[]=[];
    if(env.AUTH_MODE==='demo'&&env.LLM_MODE!=='real'&&!thread?.preparationOnly){
     const kinds=['task','course','settings','project','calendar-event','schedule-correction'],records:Record<string,any[]>={};
     for(const kind of kinds)records[kind]=(await db.prepare('SELECT * FROM records WHERE kind=?').bind(kind).all()).results.map(r=>({...r,data:JSON.parse(r.data)}));
     const now=env.LOCAL_DEMO_NOW?.()??new Date().toISOString(),day=lifeosDay(now,timezone),config=JSON.parse(env.APP_CONFIG??'{}'),settings=normalizeDomainSettings({...records.settings.find(r=>r.id==='preferences')?.data,allowedCalendarIds:Object.values(config.calendarIds??{}),schoolCalendarIds:[config.calendarIds?.schoolA,config.calendarIds?.schoolB].filter(Boolean)});
     const days=[0,1].map(offset=>{const date=addDays(day,offset),events=records['calendar-event'].map(r=>{const correction=records['schedule-correction'].find(c=>c.data.day===date&&c.data.entryId==='plan:calendar:'+r.id&&!c.data.undone)?.data;return {...r.data,id:r.id,...(correction?{start:correction.start??r.data.start,end:correction.end??r.data.end,...(correction.hidden?{status:'cancelled'}:{})}:{})};});return buildToday({now,date,records,events,settings} as any);});
     const finance=scope==='finances'?await financeSnapshot(new CloudStore(db),day):null;
     const context:any={...assistantContext({scope:'today',records,now,days} as any),timeZone:timezone,freeSlots:demoAvailableSlots(days,now),diningCard:finance?.summary?.cards.find(c=>c.id==='dining')};
     for(const task of context.tasks){const raw=records.task.find(r=>r.id===task.id)?.data;task.blocked=!!raw?.blocked||(raw?.dependencies??[]).some((id:string)=>!['complete','completed','submitted'].includes(records.task.find(r=>r.id===id)?.data.status));}
     const example=demoAssistantAnswer(scope,message?.text??p.message??'',context);
     if(example){reply=example.reply;if(example.proposals.length){await put('job-input',job.id,{job:{payload:p,context:{assistant:context}}});for(const [i,raw]of example.proposals.entries()){const {values,...proposal}=validateAssistantProposal(raw,context);void values;const id=job.id+'-p'+i;await put('assistant-proposal',id,{threadId:p.threadId,scope,jobId:job.id,proposal,contextRef:job.id,status:'proposed',expiresAt:Date.now()+86400000,targetTitle:proposal.operation==='calendar-create'?'Walk':context.schedule.flatMap((d:any)=>d.entries).find((e:any)=>e.id===proposal.recordId)?.title});demoProposals.push(id);}}}
    }
    if(thread?.preparationOnly){
     const threadRow=await db.prepare("SELECT * FROM records WHERE kind='support-thread' AND id=?").bind(p.threadId).first();const threadRecord={id:p.threadId,data:thread,createdAt:threadRow!.created_at};
     const context=projectPreparationContext(threadRecord,new Date().toISOString());
     const inputData={job:{id:job.id,payload:p,context:{assistant:context}}};await put('job-input',job.id,inputData);
     const inputRow=await db.prepare("SELECT version FROM records WHERE kind='job-input' AND id=?").bind(job.id).first();
     const artifact=prepared?prepared.artifact:{kind:'checklist',title:'Starting-point checklist',body:'[ ] Review your project notes.\n[ ] '+(thread.preparationSnapshot.nextStep||'Identify one small next action.')+'\n[ ] Check the result before continuing.',nextAction:thread.preparationSnapshot.nextStep||'Write down one small next action.',assumptions:['Canned fictional example; review all dimensions, costs and requirements.']};
     const preparation=savedProjectPreparation(threadRecord,{id:job.id,version:inputRow!.version,data:inputData},{artifact,needsInput:prepared?.needsInput??false});
     await put('support-message',job.id+'-reply',{threadId:p.threadId,role:'assistant',jobId:job.id,text:reply,scope:'today',mock:env.LLM_MODE!=='real',preparation});
    }else await put('support-message','local-answer-'+hash(job.id).slice(0,32),{threadId:p.threadId,role:'assistant',text:reply,proposalIds:demoProposals,scope:thread?.scope??'support',mock:env.LLM_MODE!=='real'});
   }else if(job.type==='lecture-study'){
    const request=await get('lecture-study-request',p.requestId),lecture=await get('lecture',p.lectureId);const type=request?.mode??'definition';
    const fields=env.LLM_MODE==='real'?validateStudyResult(JSON.parse(await chatCompletion({env,scope:'lecture',message:studyPrompt({mode:type,context:request?.context??{},page:request?.page}),context:JSON.stringify({request,lecture},(key,value)=>key==='image'?undefined:value),images:[request?.page?.image??request?.context?.slide?.image].filter(Boolean),schema:studySchema})),type):{question:'Explain the feedback loop in a thermostat.',answer:'A sensor reports temperature; heating changes it; the sensor feeds the result back to the controller.',hint:'Identify one output and the input it changes.',text:type==='index'?'Feedback loop, input, output. This demo index is an example; review your handwriting yourself.':'',uncertain:true,evidence:'Canned fictional example; review the selected page yourself.'};
    const data={...fields,type,lectureId:p.lectureId,courseId:lecture?.courseId,...(request?.context?.slide?{sourceId:request.context.slide.sourceId,sourcePage:request.context.slide.pageNumber}:{}),...(request?.page?{pageId:request.page.pageId,inkHead:request.page.inkHead}:{})};
    await put('lecture-study-item',p.lectureId+'-s-'+job.id.slice(6),data);reply='Study aid saved to your lecture.';
   }else if(job.type==='prayer-process'){
    const record=await get('prayer-session',p.sessionId);if(record)await put('prayer-session',p.sessionId,{...record,transcriptText:record.transcriptText??'Mock transcript: a quiet moment for gratitude, kindness and the community.',cleanedTranscript:record.cleanedTranscript??'Mock transcript: a quiet moment for gratitude, kindness and the community.',processingStatus:'review-needed',processingResult:{cleanedTranscript:'Mock transcript: a quiet moment for gratitude, kindness and the community.',sections:[{id:'thanksgiving',title:'Thanksgiving',summary:[{text:'Reflect on gratitude and kindness.'}]}]},archiveStatus:'local',mock:true});
    reply='Mock transcript ready for human review. The original recording remains local.';
   }else if(job.type==='cooking-help'){
    const request=await get('cooking-help-request',p.requestId??job.id),example=env.AUTH_MODE==='demo'&&env.LLM_MODE!=='real'?authoredCookingAnswer(request?.intent):null;const answer=example??{schema:1,explanation:await assistantReply('cooking',request?.intent?.question??'',env,JSON.stringify(request?.intent??request??{})),sourceExcerpts:[],questions:['What texture does your saved recipe ask for?'],suggestedStepText:null};
    await put('cooking-help-result',p.requestId??job.id,{result:answer,late:false,mock:env.LLM_MODE!=='real',intentHash:request?.intentHash});reply=answer.explanation;
   }else if(job.type==='assignment-brief'){
    const task=await get('task',p.taskId),source=p.sources?.[0];const brief=env.LLM_MODE==='real'?validateBrief(JSON.parse(await chatCompletion({env,scope:'academics',message:'Summarize these assignment instructions and the first practical step.',context:JSON.stringify({task,sources:p.sources}),schema:briefSchema})),p.sources??[]):{summary:'Mock assignment outline: explain one system and its feedback loop in your own words.',sections:[{title:'Start here',items:[{text:task?.nextStep??'Read the fictional source and identify one question.',sourceId:source?.id??p.taskId,quote:source?.text?.slice(0,200)??''}]}],missing:['Review the original fictional instructions before completing your work.'],estimatedTotalMinutes:task?.estimatedMinutes??30,estimateReason:'Authored mock estimate.',workplace:null,submission:null};await put('assignment-brief',p.taskId,{...brief,sourceHash:p.sourceHash});reply='Assignment outline saved.';
   }else if(job.type==='inspire')reply=await assistantReply('academics',p.message??'Help me start',env,JSON.stringify([{kind:'task',...await get('task',p.taskId)}]));
   else if(job.type==='coop-draft'){const role=await db.prepare("SELECT version FROM records WHERE kind='coop-role' AND id=?").bind(p.roleId).first(),profile=await db.prepare("SELECT version FROM records WHERE kind='coop-profile' AND id='owner'").first();await put('coop-draft',job.id,{roleId:p.roleId,roleVersion:role?.version,profileId:'owner',profileVersion:profile?.version,draftText:await assistantReply('coop',p.message??'',env,JSON.stringify({role:await get('coop-role',p.roleId),profile:await get('coop-profile','owner')})),unknowns:['Confirm the posting requirements and every factual claim.'],createdAt:new Date().toISOString(),sourceJobId:job.id,staleSource:false,mock:env.LLM_MODE!=='real'});reply='Application draft saved for review.';}
   else if(job.type==='friend-process'){
    const source=await get('private-friend-import',p.importId),friend=await get('private-friend',p.friendId);if(source&&friend){await put('private-friend',p.friendId,{...friend,memories:[...(friend.memories??[]),{id:randomUUID(),kind:'uncertain',text:'Ask about the community garden.',evidence:'Canned fictional response; review your imported text.',hidden:false}]});await put('private-friend-import',p.importId,{...source,status:'completed',pointCount:1,mock:true});}reply='Mock contact memory saved for review.';
   }else if(job.type==='school-collect'||job.type==='source-sync'){await put('integration','learn',{provider:'learn',title:'Fictional course sources',status:'preview-refreshed',lastCollectionAt:new Date().toISOString(),mock:true});reply='Mock refresh: fictional course sources are current. No school account was contacted.';}
   else if(job.type==='backup'){const verified=await env.LOCAL_BACKUP_RUN();reply='Verified local backup saved, including private records and file bytes. Download the complete backup from Settings.';await db.prepare("UPDATE jobs SET status='completed',result=?,progress=?,updated_at=? WHERE id=?").bind(JSON.stringify({message:reply,verified:true,downloadUrl:'/api/local/backups/'+verified.id}),reply,Date.now(),job.id).run();continue;}
   else if(job.type==='devotional-archive'){const d=await get('devotional',p.date);if(d)await put('devotional',p.date,{...d,archiveStatus:'archived',archiveId:'local-'+p.date});reply='Devotional archived in local SQLite.';}
   else if(job.type==='personal-calendar-write'){
    const command=await get('calendar-command',p.recordId);if(command)await put('calendar-command',p.recordId,{...command,status:'provider-confirmed',provider:'local',providerEtag:'local-'+job.id});if(command?.projectedEventId){const projection=await get('calendar-event',command.projectedEventId);if(projection)await put('calendar-event',command.projectedEventId,{...projection,status:'confirmed',pendingProvider:false});}
    reply='Local calendar command saved; external calendars are unchanged.';
   }else if(job.type==='maintenance'||job.type==='maintenance-release')reply='Mock maintenance report saved. Review code changes manually; automatic deployment is disabled in the standalone app.';
   await db.prepare("UPDATE jobs SET status='completed',result=?,progress=?,updated_at=? WHERE id=? AND status='queued'").bind(JSON.stringify({message:reply,reply,mock:env.LLM_MODE!=='real'}),reply,Date.now(),job.id).run();
  }catch(error){await db.prepare("UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=?").bind(error instanceof Error?error.message:'Local service request failed',Date.now(),job.id).run();}
 }
}
