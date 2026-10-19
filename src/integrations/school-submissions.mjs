import {schoolConfiguration,schoolUrl} from '../shared/service-config.mjs';
import {hash} from '../shared/hash.mjs';
import {schoolSourceUrl} from './school.mjs';
const clean=s=>String(s??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const title=s=>clean(s).toLowerCase().replace(/^[a-z]{2,8}\s*\d{3}[a-z]?\s*[-–—:]?\s*/i,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function submissionTargetKey(value,configuration={}){try{const u=new URL(schoolSourceUrl(value,configuration));if(u.hostname!==schoolConfiguration(configuration).host)return null;const ou=u.searchParams.get('ou'),id=u.searchParams.get('db')??u.searchParams.get('qi');if(!ou||!id)return u.href;return u.origin+u.pathname+'?ou='+ou+'&assessment='+id;}catch{return null;}}
export function submissionIndexUrl(value,configuration={}){try{const u=new URL(schoolSourceUrl(value,configuration));return u.hostname===schoolConfiguration(configuration).host&&/^\/d2l\/lms\/(?:dropbox\/user\/folders_list|quizzing\/user\/quizzes_list|quizzing\/user\/quiz_list)\.d2l$/i.test(u.pathname)&&/^\d+$/.test(u.searchParams.get('ou')??'')?u.href:null;}catch{return null;}}
export const submissionEvidenceSchema={type:['object','null'],additionalProperties:false,properties:{text:{type:'string'},rows:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string'},url:{type:['string','null']},quote:{type:'string'},submittedAt:{type:['string','null']}},required:['title','url','quote','submittedAt']}}},required:['text','rows']};

export function normalizeSubmissionEvidence(pages,{retrievedAt,configuration={}}){
 const records=[];
 for(const page of pages){if(page.submissions==null)continue;const url=submissionIndexUrl(page.url,configuration),source=page.submissions;
  if(!url||typeof source.text!=='string'||source.text.length>50000||!Array.isArray(source.rows)||source.rows.length>30)throw Error('Submission receipts require a bounded LEARN assignment or quiz list.');
  const courseNumber=new URL(url).searchParams.get('ou'),courseUrl=schoolUrl('/d2l/home/'+courseNumber,configuration);
  if(schoolSourceUrl(page.courseUrl,configuration)!==courseUrl)throw Error('Submission receipt course does not match its page.');
  for(const row of source.rows){const quote=clean(row.quote),name=clean(row.title);if(!name||name.length>300||!quote||quote.length>3000||!clean(source.text).includes(quote)||!quote.toLowerCase().includes(name.toLowerCase()))throw Error('A submission receipt needs the exact visible task row.');
   // A number of allowed attempts or a file on the device is not evidence of a submission.
   if(/\b(?:not (?:yet )?submitted|no submissions?|draft|in progress|not (?:yet )?completed|0 submissions?|no attempts?)\b/i.test(quote))continue;
   const quiz=url.includes('/quizzing/');
   const taskUrl=row.url?schoolSourceUrl(row.url,configuration):null;
   if(taskUrl){const task=new URL(taskUrl);if(task.hostname!==schoolConfiguration(configuration).host||task.searchParams.has('ou')&&task.searchParams.get('ou')!==courseNumber)throw Error('Submission link belongs to another course.');}
   // Brightspace lists completed quiz attempts by their feedback link. A bare
   // attempt count is ambiguous and remains insufficient.
   const feedbackReceipt=quiz&&taskUrl&&new URL(taskUrl).pathname==='/d2l/lms/quizzing/user/quiz_submissions.d2l'&&/^\d+$/.test(new URL(taskUrl).searchParams.get('qi')??'')&&/\bFeedback:\s*On Attempt\b/i.test(quote)&&/\b[1-9]\d*\s*\/\s*(?:[1-9]\d*|Unlimited)\b/i.test(quote);
   const confirmed=quiz?feedbackReceipt||/\b(?:attempt\s*\d*\s*(?:is |was |: )?completed|completed\s+attempt|submitted)\b/i.test(quote):/\b(?:submitted(?:\s+on|\s+at|\s*[:·])?|submission\s+date|[1-9]\d*\s+submissions?)\b/i.test(quote);
   if(!confirmed)continue;
   const submittedAt=row.submittedAt;if(submittedAt!==null&&(!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(submittedAt)||!Number.isFinite(Date.parse(submittedAt))||!quote.includes(submittedAt)||Date.parse(submittedAt)>Date.parse(retrievedAt)))throw Error('A submission time must be explicitly present in the receipt.');
   const courseId='school-course-'+hash('learn:'+courseNumber).slice(0,24),identity=hash({courseId,title:title(name),url:taskUrl});
   records.push({kind:'school-submission',id:'submission-'+identity.slice(0,32),data:{courseId,title:name,taskUrl,sourceUrl:url,quote,submittedAt,observedAt:retrievedAt,status:'submitted',evidenceHash:hash({quote,taskUrl,submittedAt}),authority:'visible-owner-submission-receipt'}});
  }
 }
 return records;
}
export function matchSubmittedTask(receipt,tasks,configuration={}){
 const d=receipt.data,eligible=tasks.filter(t=>t.data.courseId===d.courseId&&!t.data.archived);
 const linked=d.taskUrl?eligible.filter(t=>[t.data.source?.sourceUrl,...(t.data.sourceUrls??[]),...(t.data.submissionSources??[]).map(s=>s.url)].some(url=>submissionTargetKey(url,configuration)===submissionTargetKey(d.taskUrl,configuration))):[];
 if(linked.length===1)return linked[0];if(linked.length>1)return null;
 const named=eligible.filter(t=>title(t.data.title)===title(d.title)||(t.data.submissionSources??[]).some(s=>s.title===d.title));return named.length===1?named[0]:null;
}
export function applySubmissionReceipt(task,receipt){
 const d=receipt.data;if(d.authority!=='visible-owner-submission-receipt'||d.status!=='submitted'||task.data.courseId!==d.courseId)throw Error('Unverified submission update.');
 if(task.data.submissionEvidence?.evidenceHash===d.evidenceHash||Math.max(Date.parse(task.data.lastWorkedAt??'')||0,Date.parse(task.data.ownerStatusChangedAt??'')||0)>Date.parse(d.observedAt))return task.data;
 return {...task.data,status:'submitted',submissionStatus:'submitted',submissionEvidence:{...d,receiptId:receipt.id},completionEvidence:task.data.completionEvidence??{type:'source-receipt',receiptId:receipt.id,observedAt:d.observedAt},remainingMinutes:0,reassessmentNeeded:false};
}
