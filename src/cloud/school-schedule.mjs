import {schoolPath,schoolUrl} from '../shared/service-config.mjs';
import {submissionIndexUrl} from '../integrations/school-submissions.mjs';
import {localDate,weekday,zonedParts} from '../domain/time.mjs';import {hash} from '../shared/hash.mjs';
import {AppError} from '../shared/errors.mjs';
export const defaultSchoolWindows={morningStart:'07:30',morningEnd:'10:00',afternoonStart:'15:30',afternoonEnd:'17:00',maxDailyContinuations:2};
export function schoolWindows(preferences={},configured={}){return {...defaultSchoolWindows,...configured,...Object.fromEntries(['morningStart','morningEnd','afternoonStart','afternoonEnd'].filter(k=>preferences['school'+k[0].toUpperCase()+k.slice(1)]).map(k=>[k,preferences['school'+k[0].toUpperCase()+k.slice(1)]]))};}
export function validateSchoolWindows(preferences,configured={}){const w=schoolWindows(preferences,configured);if(![w.morningStart,w.morningEnd,w.afternoonStart,w.afternoonEnd].every(s=>/^([01]\d|2[0-3]):[0-5]\d$/.test(s))||!(w.morningStart<w.morningEnd&&w.morningEnd<=w.afternoonStart&&w.afternoonStart<w.afternoonEnd))throw new AppError('School collection windows must be ordered and must not overlap');return w;}
export async function queueSchoolCollection(store,config,now=new Date().toISOString()){
 if(!config.schoolRuntimeEnabled||await store.meta('automationPaused'))return;
 const date=localDate(now,'America/Toronto');if(weekday(date)===0)return;
 const prefs=(await store.get('settings','preferences'))?.data??{},windows=schoolWindows(prefs,config.schoolBrowserWindows),clock=zonedParts(now,'America/Toronto').time.slice(0,5),slot=clock>=windows.morningStart&&clock<windows.morningEnd?'morning':clock>=windows.afternoonStart&&clock<windows.afternoonEnd?'afternoon':null;
 if(!slot)return;
 for(const provider of ['learn','outlook','careers']){
  let key=`school-window:${date}:${slot}:${provider}`;let assessmentUrls=null;
  if(provider==='learn'&&slot==='morning'){const courses=await store.list('course');const urls=courses.flatMap(c=>{const m=schoolPath(c.data.source?.sourceUrl,/^\/d2l\/home\/\d+\/?$/,config)?new URL(c.data.source.sourceUrl).pathname.match(/^\/d2l\/home\/(\d+)\/?$/):null;return m?[c.data.source.sourceUrl,...['quizzing/user/quizzes_list','dropbox/user/folders_list'].map(p=>schoolUrl('/d2l/lms/'+p+'.d2l?ou='+m[1],config))]:[];}).slice(0,40);for(let n=0;n<urls.length;n+=4){const sliceKey=key+':assessments:'+n/4;if(!await store.meta(sliceKey)){key=sliceKey;assessmentUrls=urls.slice(n,n+4);break;}}if(urls.length&&!assessmentUrls)continue;}
  if(await store.meta(key))continue;
  // One current request per provider. An offline backlog does not produce repeated homepage crawls.
  const pending=await store.sql("SELECT id FROM jobs WHERE type='school-collect' AND status IN ('queued','running','needs-input') AND json_extract(payload,'$.provider')=? LIMIT 1",provider).first();if(pending)continue;
  const payload={provider,windowDate:date,expiresAt:Date.parse(now)+86400000};
  if(assessmentUrls){payload.sourceUrls=assessmentUrls;payload.maxPages=assessmentUrls.length;payload.assessmentCheck=true;}
  else if(provider==='learn'){const cursor=Number(await store.meta('school-course-cursor')??0),courses=(await store.list('course')).filter(c=>schoolPath(c.data.source?.sourceUrl,/^\/d2l\/home\/\d+\/?$/,config)),course=courses.length?courses[cursor%courses.length]:null;
   payload.sourceUrls=course?[course.data.source.sourceUrl]:[schoolUrl('/d2l/home',config)];payload.courseCursor=cursor;payload.courseId=course?.id??null;
   const receipts=(course?.data.submissionIndexUrls??[]).filter(value=>submissionIndexUrl(value,config));if(receipts.length&&Math.floor(cursor/Math.max(1,courses.length))%2===0){payload.sourceUrls.push(receipts[Math.floor(cursor/Math.max(1,courses.length)/2)%receipts.length]);payload.receiptCheck=true;}
   if(course&&!payload.receiptCheck){const materials=(await store.sql("SELECT id,data FROM records WHERE kind='material' AND json_extract(data,'$.courseId')=? ORDER BY updated_at,id LIMIT 100",course.id).all()).results.map(r=>({...r,data:JSON.parse(r.data)})),material=materials.find(m=>!m.data.requiresDownload&&m.data.source?.coverage!=='full-text'&&schoolPath(m.data.source?.sourceUrl,/^\/d2l\/le\/content\/\d+\/viewContent\/\d+\/View$/,config));if(material){payload.sourceUrls.push(material.data.source.sourceUrl);payload.sourceReadHints=[{url:material.data.source.sourceUrl,firstPage:material.data.browserRead?.nextPage??1}];}}
  }
  const id='school-'+hash(key).slice(0,40);await store.commit({id:'schedule-'+id,fingerprint:{key},jobs:[{id,type:'school-collect',payload,component:'collector',priority:1,authority:'configured-essential-school-window',dedupeKey:key}],extra:[store.sql('INSERT INTO meta VALUES(?,?)',key,JSON.stringify({id,at:now}))],result:{queued:true}});return;
 }
 const continuationKey='school-continuations:'+date,count=Number(await store.meta(continuationKey)??0);if(count>=Math.min(2,windows.maxDailyContinuations??2))return;
 if(await store.sql("SELECT id FROM jobs WHERE type IN ('school-collect','school-reconcile') AND status IN ('queued','running','needs-input') LIMIT 1").first())return;
 const material=await store.sql("SELECT id,data FROM records WHERE kind='material' AND CAST(json_extract(data,'$.browserRead.nextPage') AS INTEGER)>1 AND COALESCE(json_extract(data,'$.requiresDownload'),0)=0 AND json_extract(data,'$.source.coverage')!='full-text' ORDER BY updated_at,id LIMIT 1").first();if(!material)return;const data=JSON.parse(material.data),url=data.source?.sourceUrl;if(!schoolPath(url,/^\/d2l\/le\/content\/\d+\/viewContent\/\d+\/View$/,config))return;
 const key=continuationKey+':'+count,id='school-'+hash(key).slice(0,40),payload={provider:'learn',windowDate:date,courseId:data.courseId,sourceUrls:[url],sourceReadHints:[{url,firstPage:data.browserRead.nextPage}],expiresAt:Date.parse(now)+86400000,continuation:true};await store.commit({id:'schedule-'+id,fingerprint:{key},jobs:[{id,type:'school-collect',payload,component:'collector',priority:2,authority:'bounded-school-continuation',dedupeKey:key}],extra:[store.sql('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',continuationKey,JSON.stringify(count+1))],result:{queued:true}});
}
