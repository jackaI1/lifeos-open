import {schoolConfiguration,schoolUrl} from '../shared/service-config.mjs';
import {submissionIndexUrl} from './school-submissions.mjs';
import {createHash} from 'node:crypto';
import {normalizeSchoolSnapshot,schoolSourceUrl,mergeSchoolRecord} from './school.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const compact=value=>value.replace(/\s+/g,' ').trim();
const quoted=(text,quote)=>typeof quote==='string'&&quote.trim()&&compact(text).includes(compact(quote));
const nullable={type:['string','null']};
function normalizedClock(value){
 if(value===null)return null;
 if(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))return value;
 const m=/^(0?[1-9]|1[0-2]):([0-5]\d)\s*([ap])\.?m\.?$/i.exec(String(value).trim());
 return m?String(Number(m[1])%12+(m[3].toLowerCase()==='p'?12:0)).padStart(2,'0')+':'+m[2]:undefined;
}
export const schoolContentSchema={type:['object','null'],additionalProperties:false,properties:{text:{type:'string'},coverage:{type:'string',enum:['full-text','preview','requires-download']},format:{type:'string'},marked:{type:['boolean','null']},firstPage:{type:['integer','null']},lastPage:{type:['integer','null']},totalPages:{type:['integer','null']},policyQuote:nullable,tasks:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string'},quote:{type:'string'},date:nullable,time:nullable,category:{type:'string',enum:['assignment','preparation','review','practice','administrative']},marked:{type:['boolean','null']}},required:['title','quote','date','time','category','marked']}}},required:['text','coverage','format','marked','firstPage','lastPage','totalPages','policyQuote','tasks']};

function dateInQuote(date,quote){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
 const [year,month,day]=date.split('-').map(Number),parsed=new Date(`${date}T12:00:00Z`);
 if(Number.isNaN(parsed.valueOf())||parsed.toISOString().slice(0,10)!==date)return false;
 const longMonth=new Intl.DateTimeFormat('en',{month:'long',timeZone:'UTC'}).format(parsed),shortMonth=longMonth.slice(0,3),m=`(?:${longMonth}|${shortMonth}\\.?)`,d=`0?${day}(?:st|nd|rd|th)?`,y=String(year);
 return quote.includes(date)||new RegExp(`\\b(?:${m}\\s+${d},?\\s+${y}|${d}\\s+${m},?\\s+${y})\\b`,'i').test(quote);
}
function timeInQuote(time,quote){if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))return false;const [hour,minute]=time.split(':').map(Number),h=hour%12||12,suffix=hour<12?'a':'p',minutes=minute===0?'(?::00)?':':'+String(minute).padStart(2,'0');return new RegExp(`\\b(?:${time}|${h}${minutes}\\s*${suffix}\\.?m\\.?)\\b`,'i').test(quote);}

// Read-only assessment lists already contain exact rows. Extract their explicit
// due labels without needing another model to interpret or create obligations.
export function assessmentContent(page){
 if(!submissionIndexUrl(page.url)||!page.submissions)return page.content;
 const source=page.submissions,months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
 if(typeof source.text!=='string'||source.text.length>50000||!Array.isArray(source.rows)||source.rows.length>30)throw new TypeError('Invalid assessment list');
 const tasks=[];
 for(const row of source.rows){
  if(!quoted(source.text,row.quote)||!compact(row.quote).toLowerCase().includes(compact(row.title).toLowerCase()))throw new TypeError('Assessment needs its exact visible row');
  const m=/\bDue(?:\s+on)?\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i.exec(row.quote);
  if(!m)continue;
  const month=months.indexOf(m[1].slice(0,3).toLowerCase());if(month<0)continue;
  const date=m[3]+'-'+String(month+1).padStart(2,'0')+'-'+m[2].padStart(2,'0');
  const time=m[4]?String(Number(m[4])%12+(m[6].toUpperCase()==='PM'?12:0)).padStart(2,'0')+':'+m[5]:null;
  tasks.push({title:row.title,quote:row.quote,date,time,category:'assignment',marked:true});
 }
 if(!tasks.length)return page.content;
 return {text:source.text,format:'text/html',coverage:'preview',marked:true,firstPage:null,lastPage:null,totalPages:null,policyQuote:null,tasks};
}

/** Extracted facts stay source data. Only separately trusted server policy grants permission. */
export function normalizeRuntimeContent(pages,{retrievedAt,trustedPolicies={},timeZone='America/Toronto',configuration={}}={}){
 const courses=new Map(),materials=[],tasks=[],observations=[],blockers=[];
 for(const page of pages){
  const content=assessmentContent(page);if(content==null)continue;
  const url=schoolSourceUrl(page.url,configuration),parsed=new URL(url),path=parsed.pathname;
  const documentId=path.match(/\/content\/(\d+)\/viewContent\/(\d+)\//),moduleId=path.match(/^\/d2l\/le\/content\/(\d+)\/Home$/),newsId=path.match(/^\/d2l\/le\/news\/(\d+)\/(\d+)\/view$/);
  const homeId=path.match(/^\/d2l\/home\/(\d+)\/?$/),index=submissionIndexUrl(url,configuration),contentId=documentId??(homeId?[null,homeId[1],'home-announcements:'+homeId[1]]:null)??(moduleId?[null,moduleId[1],'module:'+moduleId[1]+':'+digest(parsed.searchParams.get('itemIdentifier')??page.title).slice(0,20)]:index?[null,parsed.searchParams.get('ou'),'assessment-index:'+parsed.searchParams.get('ou')+':'+(path.includes('quizzing')?'quizzes':'assignments')]:newsId?[null,new URL(page.courseUrl??url).pathname.match(/^\/d2l\/home\/(\d+)$/)?.[1]??newsId[1],'announcement:'+newsId[2]]:null);
  if(!contentId||parsed.hostname!==schoolConfiguration(configuration).host)throw new TypeError('Source text requires a course material, module, announcement or assessment index URL');
  const courseSourceId=`learn:${contentId[1]}`,courseUrl=schoolSourceUrl(page.courseUrl??schoolUrl(`/d2l/home/${contentId[1]}`,configuration),configuration);
  if(new URL(courseUrl).pathname!==`/d2l/home/${contentId[1]}`||typeof page.courseTitle!=='string'||!page.courseTitle.trim())throw new TypeError('A material needs its visible matching course identity');
  if(typeof content.text!=='string'||content.text.length>100000||!['full-text','preview','requires-download'].includes(content.coverage)||typeof content.format!=='string'||content.format.length>100||!Array.isArray(content.tasks)||content.tasks.length>30)throw new TypeError('Invalid or oversized school document evidence');
  if(content.coverage==='full-text'&&!content.text.trim())throw new TypeError('Full-text coverage needs real source text');
  const numbered=[content.firstPage,content.lastPage,content.totalPages];if(numbered.some(value=>value!=null)){if(numbered.some(value=>!Number.isInteger(value)||value<1||value>1000)||content.firstPage>content.lastPage||content.lastPage>content.totalPages)throw new TypeError('Invalid visible document page range');if(content.coverage==='full-text'&&(content.firstPage!==1||content.lastPage!==content.totalPages))throw new TypeError('A partial page range is not full-text coverage');}
  if(content.coverage==='requires-download'&&(content.tasks.length||content.policyQuote))throw new TypeError('Unreadable documents cannot supply tasks or policy');
  const course={sourceId:courseSourceId,url:courseUrl,title:page.courseTitle,coverage:'catalogue',locator:page.title,sourceRevision:null};
  if(content.policyQuote){if(content.policyQuote.length>20000||!quoted(content.text,content.policyQuote))throw new TypeError('Policy quote must appear in the captured source text');course.policyEvidence={text:content.policyQuote,url,locator:page.title};}
  const oldCourse=courses.get(courseSourceId);courses.set(courseSourceId,{...oldCourse,...course,...(oldCourse?.policyEvidence&&!course.policyEvidence?{policyEvidence:oldCourse.policyEvidence}:{})});
  const sourceId=`learn:${contentId[2]}`;
  materials.push({sourceId,url,title:page.title,courseSourceId,format:content.format,text:content.text,coverage:content.coverage==='requires-download'?'metadata':content.coverage,sourceRevision:page.sourceRevision,locator:page.title,marked:content.marked});
  if(content.coverage==='requires-download')blockers.push(`${page.title}: document text requires an approved download or readable browser preview.`);
  for(const task of content.tasks){
   if(typeof task.title!=='string'||!task.title.trim()||task.title.length>300||typeof task.quote!=='string'||task.quote.length>3000||!quoted(content.text,task.quote))throw new TypeError('A task requires an exact quotation from the captured material');
   if(task.date!==null&&!dateInQuote(task.date,task.quote))throw new TypeError('A due date requires its explicit year, month and day in the source quotation');
   let time=normalizedClock(task.time);
   const quotedRange=typeof task.time==='string'&&/^\d{1,2}(?::[0-5]\d)?\s*[-–]\s*\d{1,2}:[0-5]\d\s*(?:a\.?m\.?|p\.?m\.?)$/i.test(task.time.trim())&&quoted(task.quote,task.time);
   if(time===undefined&&quotedRange){time=null;blockers.push('A quoted time range is not a single due time; review the source.');}
   if(task.time!==null&&(time===undefined||time!==null&&!timeInQuote(time,task.quote)))throw new TypeError('A due time must appear in the source quotation');
   tasks.push({sourceId:`${sourceId}:task:${digest(compact(task.title).toLowerCase()).slice(0,20)}`,courseSourceId,url,title:task.title,text:task.quote,coverage:'source-derived',sourceRevision:page.sourceRevision,locator:page.title,category:task.category,marked:task.marked,materialSourceIds:[sourceId],due:task.date?{date:task.date,time:time??undefined,timeZone,basis:'source-explicit',sourceUrls:[url],rule:task.quote}:null,notes:task.quote,nextStep:'Open the linked requirements and identify the next step you can do yourself.'});
  }
  observations.push({sourceId,url,coverage:content.coverage,sha256:digest(content.text),textLength:content.text.length,taskCount:content.tasks.length,firstPage:content.firstPage??null,lastPage:content.lastPage??null,totalPages:content.totalPages??null,nextPage:content.lastPage&&content.lastPage<content.totalPages?content.lastPage+1:1});
 }
 const normalized=normalizeSchoolSnapshot({retrievedAt,courses:[...courses.values()],materials,tasks,observations:[],blockers},{trustedPolicies,timeZone,configuration});
 for(const record of normalized.records)if(record.kind==='material'){const observed=observations.find(item=>item.sourceId===record.data.source.sourceId);record.data.browserRead=observed;record.data.requiresDownload=observed.coverage==='requires-download';}
 return {...normalized,contentObservations:observations};
}

export function mergeRuntimeContent(existing,incoming){
 if(!existing)return structuredClone(incoming);
 if(existing.id!==incoming.id||existing.kind!==incoming.kind)throw new TypeError('School source identity mismatch');
 if(incoming.kind==='course')return {...incoming,data:{...existing.data,...(incoming.data.policyEvidence?{policyEvidence:incoming.data.policyEvidence}:{}),catalogueObservedAt:incoming.data.source.retrievedAt}};
 if(incoming.kind==='material'&&existing.data.text&&incoming.data.source.coverage!=='full-text'){
  const fragments=[...(existing.data.sourceFragments??[]),{source:incoming.data.source,text:incoming.data.text,pageRange:incoming.data.browserRead}];
  const unique=new Map(fragments.map(fragment=>[`${fragment.source.sha256}:${fragment.pageRange?.firstPage??'unknown'}`,fragment]));
  return {...incoming,data:{...existing.data,browserRead:incoming.data.browserRead,requiresDownload:incoming.data.requiresDownload,sourceRefresh:{source:incoming.data.source,text:incoming.data.text,partial:true},sourceFragments:[...unique.values()]}};
 }
 const merged=mergeSchoolRecord(existing,incoming);
 if(incoming.kind==='task'){
  if(existing.data.dueEvidence&&!incoming.data.dueEvidence)for(const key of ['dueAt','dueDate','duePrecision','dueEvidence'])merged.data[key]=structuredClone(existing.data[key]);
  for(const key of ['effortRange','estimateBasis','estimateConfidence','verifiedSourceAliases','deadlineResolution'])if(existing.data[key]!=null)merged.data[key]=structuredClone(existing.data[key]);
 }
 return merged;
}
