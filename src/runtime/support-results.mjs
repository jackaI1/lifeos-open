import {randomUUID} from 'node:crypto';
import {hash} from '../shared/hash.mjs';
import {localDate,addDays,zonedDateTime,validDate} from '../domain/time.mjs';

const failure=(message,code='invalid_result')=>Object.assign(new Error(message),{code});
const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const practiceWord='(?:prayer(?: time)?|devotional|devotions)';
const patterns=[
  {complete:false,re:/^I\s+(?:did not|didn't|have not|haven't|had not|hadn't)\s+(?:yet\s+)?pray(?:ed)?\b/i,practice:'prayer'},
  {complete:false,re:new RegExp(`^I\\s+(?:did not|didn't|have not|haven't|had not|hadn't)\\s+(?:yet\\s+)?(?:finish(?:ed)?|complete(?:d)?|do|done)\\s+(?:my\\s+)?(${practiceWord})\\b`,'i')},
  {complete:true,re:/^I\s+(?:(?:have|had|did)\s+)?(?:just\s+)?pray(?:ed)?\b/i,practice:'prayer'},
  {complete:true,re:new RegExp(`^I\\s+(?:(?:have|had)\\s+)?(?:just\\s+)?(?:finished|completed|did|done)\\s+(?:my\\s+)?(${practiceWord})\\b`,'i')},
  {re:new RegExp(`^My\\s+(${practiceWord})\\s+is\\s+(not complete|incomplete|not done|complete|done|finished)\\b`,'i'),stateGroup:2},
  {re:new RegExp(`^(?:Mark|Set|Correct)\\s+(?:my\\s+)?(${practiceWord})\\s+(?:as|to)\\s+(not complete|incomplete|not done|complete|done|finished)\\b`,'i'),stateGroup:2}
];

/** Conservative completion grammar. Questions, quotations, inferred dates and ambiguous clocks grant no mutation authority. */
export function explicitSpiritualStatements({message,messageAt,timeZone='America/Toronto',now=new Date().toISOString()}){
  const sent=iso(messageAt),current=iso(now);if(typeof message!=='string'||message.length>20000||!sent||!current||Date.parse(sent)>Date.parse(current)+300000)throw failure('The saved message time is unavailable or invalid','message_context_invalid');
  const today=localDate(sent,timeZone),statements=[];
  for(const raw of message.split(/(?<=[!?;])\s*|\n+|\.(?=\s+[A-Z]|\s*$)/)){
    const evidence=raw.trim().replace(/[!;]+$/,'').trim();if(!evidence)continue;if(evidence.endsWith('?'))break;
    const normalized=evidence.replace(/[’]/g,"'").replace(/^(?:Actually|Correction|For the record)[,:]?\s+/i,'');
    // Only a leading series of direct owner declarations is eligible. Later quoted/source blocks grant no authority.
    let match,pattern;for(const candidate of patterns){match=normalized.match(candidate.re);if(match){pattern=candidate;break;}}if(!pattern)break;
    // Present habitual "I pray" is not evidence of a completed occurrence.
    if(pattern.practice==='prayer'&&pattern.complete&&!/\b(?:prayed|did\s+pray)\b/i.test(match[0]))continue;
    const practice=pattern.practice??(/^prayer/i.test(match[1])?'prayer':'devotional'),complete=pattern.stateGroup?!/^(?:not |incomplete)/i.test(match[pattern.stateGroup]):pattern.complete;
    let remainder=normalized.slice(match[0].length).trim(),date=null,observedAt=null;
    const dates=[...remainder.matchAll(/\b(today|yesterday|this morning|this afternoon|this evening|tonight|\d{4}-\d{2}-\d{2})\b/gi)];
    if(dates.length>1||/\b(?:tomorrow|next|last|if|would|will|might|not|but|because|quote|example)\b/i.test(remainder))continue;
    const nowMention=/\bnow\b/i.test(remainder),justMention=/\bjust\b/i.test(match[0]);
    if(dates.length===1){const value=dates[0][0].toLowerCase();date=value==='yesterday'?addDays(today,-1):/^\d{4}-/.test(value)?value:today;remainder=remainder.replace(dates[0][0],'');}
    else if(nowMention||justMention)date=today;
    if(!date||!validDate(date)||date>today)continue;
    const clocks=[...remainder.matchAll(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/gi)];if(clocks.length>1||nowMention&&clocks.length||!complete&&clocks.length)continue;
    if(nowMention){if(date!==today)continue;observedAt=sent;remainder=remainder.replace(/\bnow\b/i,'');}
    if(clocks.length){
      const [clock,hourText,minuteText,meridiem]=clocks[0];let hour=Number(hourText),minute=Number(minuteText??0);if(minute>59)continue;
      if(meridiem){if(hour<1||hour>12)continue;hour=hour%12+(/^p/i.test(meridiem)?12:0);}
      else if(hour>23||minuteText===undefined||hourText.length!==2)continue;
      try{observedAt=zonedDateTime(date,`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`,{timeZone});}catch{continue;}
      if(Date.parse(observedAt)>Date.parse(sent))continue;remainder=remainder.replace(clock,'');
    }
    // Any remaining assertion or instruction makes this clause too ambiguous for an automatic correction.
    if(remainder.replace(/\b(?:on|for|yet|already|fully)\b/gi,'').replace(/[\s,.]/g,''))continue;
    statements.push({practice,date,complete,observedAt:complete?observedAt:null,evidence});
  }
  const byTarget=new Map();for(const statement of statements){const key=`${statement.date}:${statement.practice}`,old=byTarget.get(key);if(old&&JSON.stringify({...old,evidence:null})!==JSON.stringify({...statement,evidence:null}))byTarget.set(key,{ambiguous:true});else if(!old)byTarget.set(key,statement);}
  return [...byTarget.values()].filter(statement=>!statement.ambiguous);
}

export function assertJobLease({store,job,workerId,now=Date.now()}){
  const row=store.db.prepare('SELECT status,lease_owner,lease_until,cancel_requested FROM jobs WHERE id=?').get(job.id);
  if(!row||row.status!=='running'||row.lease_owner!==workerId||row.lease_until<=now||row.cancel_requested)throw failure('This worker no longer owns the active request',row?.cancel_requested?'cancelled':'lease_lost');
}
const requestHash=job=>hash({type:job.type,payload:job.payload,authority:job.authority});
export function appliedJobResult(store,job){const saved=store.get('job-result',job.id);if(!saved)return null;if(saved.data.requestHash!==requestHash(job))throw failure('An applied job ID has a different request','idempotency_conflict');return saved.data.result;}

export function supportContext({store,job,now=new Date().toISOString()}){
  const message=store.get('support-message',job.payload.messageId);if(!message||message.data.role!=='user'||message.data.threadId!==job.payload.threadId||message.data.text!==job.payload.message)throw failure('The request does not match its saved authenticated user message','message_context_invalid');
  const statements=explicitSpiritualStatements({message:message.data.text,messageAt:message.createdAt,now});
  const versions={};for(const s of statements){for(const [kind,id] of [['spiritual',`${s.date}-${s.practice}`],...(s.practice==='devotional'?[['devotional',s.date]]:[])])versions[`${kind}:${id}`]=store.get(kind,id)?.version??0;}
  return {messageAt:message.createdAt,statements,versions};
}

/** Run inside the worker's final SQLite transaction. Effects and the applied-result marker commit together. */
export function applySupportResult({store,job,response,context,now=new Date().toISOString()}){
  const cached=appliedJobResult(store,job);if(cached)return cached;
  const out=response.result;if(typeof out?.reply!=='string'||out.reply.length>30000||typeof out.needsInput!=='boolean'||!Array.isArray(out.corrections)||out.corrections.length>5)throw failure('Invalid structured response');
  let needsInput=out.needsInput,explanation=null;const corrections=[],accepted=[];
  if(!needsInput)for(const proposed of out.corrections){
    if(!proposed||typeof proposed!=='object'||Array.isArray(proposed)){needsInput=true;explanation='The proposed correction needs clarification. Your records have not changed.';break;}
    const statement=context.statements.find(s=>s.practice===proposed.practice&&s.date===proposed.date&&s.complete===proposed.complete&&typeof proposed.evidence==='string'&&proposed.evidence.trim().replace(/[.!?;]+$/,'').trim()===s.evidence&&job.payload.message.includes(proposed.evidence));
    const proposedAt=proposed.observedAt===null?null:iso(proposed.observedAt);
    if(!statement||proposed.observedAt!==null&&(!proposedAt||proposedAt!==statement.observedAt)){needsInput=true;explanation='I kept the records unchanged because the completion statement or its date and time needs clarification.';break;}
    if(accepted.some(s=>s.practice===statement.practice&&s.date===statement.date))continue;
    const keys=[['spiritual',`${statement.date}-${statement.practice}`],...(statement.practice==='devotional'?[['devotional',statement.date]]:[])];
    if(keys.some(([kind,id])=>(store.get(kind,id)?.version??0)!==context.versions[`${kind}:${id}`])){needsInput=true;explanation='Your record changed while I was responding. I kept your later change. Please review the current record.';break;}
    if(statement.practice==='devotional'){
      const devotional=store.get('devotional',statement.date);if(!devotional||statement.complete&&(devotional.data.points?.length!==7||devotional.data.points.some(point=>typeof point!=='string'||!point.trim()))){needsInput=true;explanation='The devotional needs seven saved responses before it can be marked complete. Your writing has not changed.';break;}
    }
    accepted.push(statement);
  }
  if(!needsInput)for(const statement of accepted){
    const id=`${statement.date}-${statement.practice}`,old=store.get('spiritual',id),oldAt=old?.data.completedAt??old?.data.observedAt;
    const retainedAt=old?.data.complete&&iso(oldAt)&&localDate(oldAt,'America/Toronto')===statement.date&&Date.parse(oldAt)<=Date.parse(context.messageAt)?iso(oldAt):null;
    const completedAt=statement.complete?statement.observedAt??retainedAt:null;
    let devotional;if(statement.practice==='devotional'){
      const current=store.get('devotional',statement.date);devotional=store.put('devotional',statement.date,{...current.data,complete:statement.complete,completedAt,archiveStatus:statement.complete?'queued':current.data.archiveStatus??'not-needed'},current.version,{actor:'owner-support-correction'});
      if(statement.complete)store.enqueue('devotional-archive',{date:statement.date,version:devotional.version},{priority:6,authority:'owner-support-correction'});
    }
    const item=store.put('spiritual',id,{...old?.data,...(devotional?{plan:devotional.data.plan??null,context:devotional.data.context??'other',schoolMinutes:devotional.data.schoolMinutes??0}:{}),date:statement.date,practice:statement.practice,complete:statement.complete,completedAt,observedAt:completedAt,recordedAt:now,evidence:'self-reported',sourceMessageId:job.payload.messageId},old?.version??0,{actor:'owner-support-correction'});
    corrections.push({id:item.id,auditId:item.auditId,...(devotional?{devotionalAuditId:devotional.auditId}:{})});
  }
  const thread=store.get('support-thread',job.payload.threadId);if(!thread)throw failure('The Support conversation no longer exists','record_missing');
  store.upsertInternal('support-thread',thread.id,{...thread.data,...(typeof response.threadId==='string'&&response.threadId?{aiThreadId:response.threadId}: {})},'support-runtime');
  const reply=explanation??out.reply,result={reply,needsInput,corrections,threadId:thread.id};
  store.put('support-message',randomUUID(),{threadId:thread.id,role:'assistant',text:reply,jobId:job.id,needsInput,corrections},0,{actor:'support-runtime'});
  store.put('job-result',job.id,{type:job.type,requestHash:requestHash(job),appliedAt:now,result},0,{actor:'support-runtime'});return result;
}

export function savePlainJobResult({store,job,result,now=new Date().toISOString()}){const cached=appliedJobResult(store,job);if(cached)return cached;store.put('job-result',job.id,{type:job.type,requestHash:requestHash(job),appliedAt:now,result},0,{actor:'ai-runtime'});return result;}
