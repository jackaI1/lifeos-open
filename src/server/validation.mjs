import {themeIds} from '../../public/themes.js';
import {validatePrayerList,validatePrayerNodes} from '../../public/prayer-tree.js';
import {validateDocument,documentText} from '../../public/document-format.js';
import {selectedPassage} from '../../public/bible.js';
import {AppError} from '../shared/errors.mjs';
import {assistantPreset} from '../../public/assistant-presets.js';
import {githubProjectUrl} from '../../public/github-project-url.js';
const fields={
 'prayer-list':'sections',
 'accountability-draft':'entryId entryVersion previousEntryId prayerSessionId prayed repentance followThrough applications text status approvedAt',
 settings:'theme spiritualPracticesEnabled notificationDeviceId textSize controlDensity handedness accountabilityDiscordUrl hourlyPrayerReminder schoolMorningStart schoolMorningEnd schoolAfternoonStart schoolAfternoonEnd timezone wakeTime lightsOut prayerWakeLock quietStart quietEnd lateRounding schoolStart schoolEnd morningCommuteMinutes eveningCommuteMinutes breakfastMinutes lunchPrepMinutes dinnerMinutes fridayTravelMinutes fridayBedtime saturdayWakeTime prayerCampusLocation devotionalCampusLocation locationLabels readingPlan exceptions',
 'prayer-note':'section title text archived rotation people notes weekday weekdays nodes',
 project:'title category notes status archived nextStep steps timeBlocks githubUrl',meal:'title notes recipe day slot ingredients steps',grocery:'title checked quantity notes archived',
 coursework:'title taskId text language document attachmentIds notes archived',training:'weeklyKm longestKm pain injury recovery guidance raceDate goalMinutes sundayExceptionConfirmed baselineDate notes',
 run:'date distanceKm durationMinutes effort pain fatigue notes workoutId', 'support-thread':'title archived model effort',
 'coop-role':'title employer sourceUrl deadlineDate deadlineTime deadlineEvidence status location industry description notes draftText archived'
};
export const writableKinds=Object.keys(fields);
export const readableKinds=[...writableKinds,'devotional-step','reminder','reminder-list','prayer-session','spiritual','presence','presence-correction','schedule-correction','ticket-spend','course','material','task','work-session','support-message','integration','devotional-import','calendar-event','notification','release','attachment','training-source','coop-profile','coop-draft'];
export function object(value){if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('A JSON object is required');return value;}
export function identifier(value){if(typeof value!=='string'||!/^[-\w]{1,100}$/.test(value))throw new AppError('Invalid record identifier');return value;}
export function mutationId(value){if(typeof value!=='string'||!/^[-a-zA-Z0-9_:]{16,128}$/.test(value))throw new AppError('A unique request ID is required');return value;}
export function text(value,max=20000,{required=false}={}){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new AppError('Invalid or oversized text');return value;}
export function number(value,min,max){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new AppError('Number is outside its allowed range');return value;}
export function boolean(value){if(typeof value!=='boolean')throw new AppError('A true or false value is required');return value;}
export function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw new AppError('Invalid calendar date');return value;}
export function version(value){if(!Number.isSafeInteger(value)||value<0)throw new AppError('Record revision required');return value;}
export function enumValue(value,allowed){if(!allowed.includes(value))throw new AppError('Unsupported value');return value;}
export function exactFields(value,allowed){object(value);for(const key of Object.keys(value))if(!allowed.includes(key))throw new AppError('Unsupported field: '+key);return value;}
function safeTree(value,depth=0,maxDepth=8){if(depth>maxDepth)throw new AppError('Record is too deeply nested');if(typeof value==='string')text(value,200000);else if(typeof value==='number'&&!Number.isFinite(value))throw new AppError('Invalid number');else if(Array.isArray(value)){if(value.length>1000)throw new AppError('Too many values');value.forEach(v=>safeTree(v,depth+1,maxDepth));}else if(value&&typeof value==='object'){for(const [key,v]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))throw new AppError('Invalid property');safeTree(v,depth+1,maxDepth);}}}
const clock=value=>{if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw new AppError('A valid HH:mm clock time is required');return value;};
const optionalBoolean=value=>value===null||value===''?null:typeof value==='boolean'?value:['no','none'].includes(String(value).toLowerCase())?false:String(value).toLowerCase()==='yes'?true:boolean(value);
export function recordData(kind,input){
 object(input);const allowed=fields[kind]?.split(' ');if(!allowed)throw new AppError('This record can only be changed through its application action',403);
 exactFields(input,allowed);safeTree(input,0,kind==='coursework'?32:['prayer-list','prayer-note'].includes(kind)?20:8);if(JSON.stringify(input).length>(kind==='coursework'?750000:250000))throw new AppError('Record is too large',413);const data=structuredClone(input);
 if(data.title!==undefined)text(data.title,300);for(const key of ['archived','checked','prayerWakeLock','sundayExceptionConfirmed'])if(data[key]!==undefined)boolean(data[key]);
 if(kind==='support-thread'&&(data.model!==undefined||data.effort!==undefined)&&!assistantPreset(data.model,data.effort))throw new AppError('Choose a supported model and effort');
 if(kind==='project'){for(const [key,limit]of [['steps',200],['timeBlocks',100]])if(data[key]!==undefined){if(!Array.isArray(data[key])||data[key].length>limit)throw new AppError('Too many project entries');for(const row of data[key]){identifier(row.id);if(key==='steps'){exactFields(row,['id','title','done']);text(row.title,300,{required:true});boolean(row.done);}else{exactFields(row,['id','minutes','day']);number(row.minutes,1,1440);date(row.day);}}}}
 if(kind==='project'&&data.nextStep!==undefined)text(data.nextStep,2000);
 if(kind==='project'&&data.githubUrl!==undefined){const url=githubProjectUrl(data.githubUrl);if(!url)throw new AppError('Use an HTTPS GitHub profile or repository URL');data.githubUrl=url;}
 if(kind==='accountability-draft'){identifier(data.entryId);version(data.entryVersion);for(const k of ['previousEntryId','prayerSessionId'])if(data[k]!=null)identifier(data[k]);for(const k of ['prayed','repentance','followThrough','applications','text'])text(data[k],22000);enumValue(data.status,['draft','approved']);if(data.approvedAt!=null&&!Number.isFinite(Date.parse(data.approvedAt)))throw new AppError('Invalid approval time');}
 if(kind==='settings'){
  if(data.theme!==undefined)enumValue(data.theme,themeIds);
  if(data.notificationDeviceId)identifier(data.notificationDeviceId);
  if(data.textSize!==undefined)enumValue(data.textSize,['standard','large','largest']);if(data.controlDensity!==undefined)enumValue(data.controlDensity,['compact','spacious']);if(data.handedness!==undefined)enumValue(data.handedness,['left','right']);
  if(data.accountabilityDiscordUrl!==undefined&&!/^https:\/\/discord\.com\/channels\/@me\/\d+$/.test(data.accountabilityDiscordUrl))throw new AppError('Use the Discord direct-message URL');
  if(data.hourlyPrayerReminder!==undefined)boolean(data.hourlyPrayerReminder);
  if(data.spiritualPracticesEnabled!==undefined)boolean(data.spiritualPracticesEnabled);
  if(data.timezone!==undefined){try{new Intl.DateTimeFormat('en',{timeZone:data.timezone}).format();}catch{throw new AppError('Unknown timezone');}}
  for(const key of ['schoolMorningStart','schoolMorningEnd','schoolAfternoonStart','schoolAfternoonEnd','wakeTime','lightsOut','quietStart','quietEnd','schoolStart','schoolEnd','fridayBedtime','saturdayWakeTime'])if(data[key]!==undefined)clock(data[key]);
  for(const key of ['morningCommuteMinutes','eveningCommuteMinutes','breakfastMinutes','lunchPrepMinutes','dinnerMinutes','fridayTravelMinutes'])if(data[key]!==undefined)number(data[key],0,360);
  if(data.lateRounding!==undefined)enumValue(data.lateRounding,['ceil','floor','nearest']);
  if(data.exceptions!==undefined){object(data.exceptions);if(Object.keys(data.exceptions).length>366)throw new AppError('Too many daily exceptions');for(const[day,changes]of Object.entries(data.exceptions)){date(day);if(changes.exceptions)throw new AppError('Daily exceptions cannot contain more exceptions');data.exceptions[day]=recordData('settings',changes);}}
 }
 if(kind==='prayer-list'){try{data.sections=validatePrayerList(data.sections);}catch(e){throw new AppError(e.message);}}
 if(kind==='prayer-note'){
  if(data.nodes!==undefined){try{data.nodes=validatePrayerNodes(data.nodes);}catch(e){throw new AppError(e.message);}}
  if(data.section!==undefined)enumValue(data.section,['thanksgiving','repentance','daily-others','daily-bread','regular-others','spontaneous-others',0,1,2,3,4,5]);
  if(data.weekday!=null)number(data.weekday,0,6);if(data.weekdays!==undefined){if(!Array.isArray(data.weekdays)||data.weekdays.length>7)throw new AppError('Invalid weekday rotation');data.weekdays.forEach(value=>{number(value,0,6);if(!Number.isInteger(value))throw new AppError('Whole weekdays required');});}
 }
 if(kind==='coursework'){if(data.attachmentIds!==undefined){if(!Array.isArray(data.attachmentIds)||data.attachmentIds.length>30)throw new AppError('At most 30 document attachments');data.attachmentIds.forEach(identifier);}if(data.document!==undefined){try{data.document=validateDocument(data.document);data.text=documentText(data.document);}catch(e){throw new AppError(e.message);}}if(data.taskId)identifier(data.taskId);if(data.language!==undefined)enumValue(data.language,['text','code']);}
 if(kind==='coop-role'){
  text(data.title,300,{required:true});text(data.employer,300,{required:true});
  for(const key of ['location','industry'])if(data[key]!==undefined)text(data[key],300);
  for(const key of ['notes','draftText'])if(data[key]!==undefined)text(data[key],100000);if(data.description!==undefined)text(data.description,40000);
  if(data.deadlineEvidence!==undefined)text(data.deadlineEvidence,3000);
  if(data.deadlineDate)date(data.deadlineDate);if(data.deadlineTime){clock(data.deadlineTime);if(!data.deadlineDate)throw new AppError('A deadline time requires a date');}
  if(data.status!==undefined)enumValue(data.status,['interested','researching','drafting','ready','applied','interview','offer','closed']);
  if(data.sourceUrl){text(data.sourceUrl,3000);let url;try{url=new URL(data.sourceUrl);}catch{throw new AppError('Use the original HTTPS role URL');}if(url.protocol!=='https:'||url.username||url.password)throw new AppError('Use an HTTPS role URL without credentials');for(const key of url.searchParams.keys())if(/token|password|secret|cookie|authorization|^code$/i.test(key))throw new AppError('Credential-bearing role URLs cannot be saved');}
 }
 if(kind==='training'){
  for(const key of ['weeklyKm','longestKm'])if(data[key]!=null&&data[key]!=='')number(data[key],0,300);
  if(data.goalMinutes!==undefined)number(data.goalMinutes,120,1000);if(data.raceDate)date(data.raceDate);if(data.baselineDate)date(data.baselineDate);
  for(const key of ['pain','injury'])if(data[key]!==undefined)data[key]=optionalBoolean(data[key]);
  if(data.recovery!==undefined)enumValue(data.recovery,['','good','mixed','poor','exhausted','ill']);
  if(data.guidance!==undefined)text(data.guidance,10000);
 }
 if(kind==='run'){date(data.date);number(data.distanceKm,0,200);number(data.durationMinutes,0,3000);if(data.effort!=null)number(data.effort,1,10);}
 return data;
}
export function devotional(body){
 object(body);const custom=body.type==='custom';if(body.type!==undefined)enumValue(body.type,['standard','custom']);if(custom)text(body.customText??'',100000);if(!Array.isArray(body.points)||body.points.length!==7||!body.points.every(p=>typeof p==='string'&&p.length<=100000))throw new AppError('Seven responses are required, each at most 100,000 characters');
 boolean(body.complete);if(body.complete&&(custom?!body.customText?.trim():!body.points.every(p=>p.trim())))throw new AppError('Answer all seven prompts before confirming completion');version(body.version);
 const output={points:body.points,complete:body.complete,passage:text(body.passage??'',500),type:body.type??'standard',customText:text(body.customText??'',100000)};if(body.synthetic!==undefined)output.synthetic=boolean(body.synthetic);if(body.testRunId!==undefined)output.testRunId=text(body.testRunId,100,{required:true});
 if(body.bookId!==undefined&&body.bookId!==null){try{Object.assign(output,selectedPassage(body.bookId,body.chapter,body.chapterEnd??body.chapter));output.chapterEnd??=null;}catch{throw new AppError("Choose a valid book and chapter range");}}else if(body.bookId===null){output.bookId=null;output.chapter=null;output.chapterEnd=null;}
 if(body.archiveRequested!==undefined)boolean(body.archiveRequested);
 if(body.archiveRequested===true&&(custom?!body.customText?.trim():(!output.bookId||!body.points.every(p=>p.trim()))))throw new AppError('Choose a canonical passage and write seven reflections before syncing the journal');
 if(body.plan!==undefined&&body.plan!==null&&body.plan!=='')output.plan=enumValue(body.plan,['A','B','C','D']);
 if(body.context!==undefined)output.context=enumValue(body.context,['morning','planned-school-time','before-home','recovery','other']);
 if(body.schoolMinutes!==undefined)output.schoolMinutes=number(body.schoolMinutes,0,360);
 if(body.observedAt!==undefined)output.observedAt=body.observedAt;
 return output;
}
export function jobRequest(body){
 object(body);const {type}=body;const payload=object(body.payload??{});enumValue(type,['support','inspire','coop-draft','prayer-process','source-sync','backup','maintenance']);safeTree(payload);if(JSON.stringify(payload).length>50000)throw new AppError('Request too large',413);
 const allowed={support:['threadId','message','attachmentIds','model','effort'],inspire:['taskId','message'],'coop-draft':['roleId','message'], 'prayer-process':['sessionId'], 'source-sync':['provider'],backup:[],maintenance:['description','route','version','intentional','diagnostics','attachmentIds']};exactFields(payload,allowed[type]);
 if(type==='support'){identifier(payload.threadId);text(payload.message,20000,{required:true});if((payload.model!==undefined||payload.effort!==undefined)&&!assistantPreset(payload.model,payload.effort))throw new AppError('Choose a supported model and effort');}
 if(type==='inspire'){identifier(payload.taskId);if(payload.message!==undefined)text(payload.message,5000);}
 if(type==='coop-draft'){identifier(payload.roleId);if(payload.message!==undefined)text(payload.message,2000);}
 if(type==='prayer-process')identifier(payload.sessionId);
 if(type==='source-sync'&&payload.provider!==undefined)enumValue(payload.provider,['school','google','calendar','drive','all']);
 if(payload.attachmentIds!==undefined){if(!Array.isArray(payload.attachmentIds)||payload.attachmentIds.length>5)throw new AppError('At most five attachments are allowed');payload.attachmentIds.forEach(identifier);}
 if(type==='maintenance'){if(body.intentional!==true&&payload.intentional!==true)throw new AppError('A code change requires an intentional authenticated report',403);text(payload.description,10000,{required:true});if(payload.route!==undefined)text(payload.route,100);if(payload.version!==undefined)text(payload.version,100);const diagnostics=object(payload.diagnostics??{});exactFields(diagnostics,['online','userAgent','errorCode','route','version']);for(const[key,value]of Object.entries(diagnostics))if(key==='online')boolean(value);else text(value,300);}
 return {type,payload:{...payload,...(type==='maintenance'?{intentional:true}:{})}};
}
