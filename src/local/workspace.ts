import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {WorkspaceDatabase} from './database.ts';
import {LocalObjects} from './objects.ts';
import {scenarioRecords,scenarioEvents,assignmentBundle,STORY_DAY} from '../../demo/scenarios.mjs';
import {assignmentSources} from '../shared/assignment-brief.mjs';
import {publicProjectRecords} from '../../demo/public-projects.mjs';
import {createDemoMarathonSource,DEMO_MARATHON_GOAL_MINUTES} from '../../demo/marathon-plan.mjs';
import {lifeosDay} from '../../public/lifeos-day.js';
const sha=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
export const DEMO_NAME='Alex Morgan';
export const DEMO_EMAIL='alex@example.invalid';
export function syntheticAudio(){const rate=8000,seconds=6,buffer=Buffer.alloc(44+rate*seconds*2);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(buffer.length-44,40);for(let i=0;i<rate*seconds;i++)buffer.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/rate)*800*Math.sin(i*Math.PI/(rate*seconds))),44+i*2);return buffer;}
export async function makeWorkspace(db:WorkspaceDatabase,{demo=true,now=new Date(),owner=DEMO_EMAIL,readAsset:load=readFile}={}){
 db.exec(await load('src/cloud/schema.sql','utf8'));
 if(await db.prepare("SELECT value FROM meta WHERE key='local-initialized'").first()){if(demo)await refreshDemoExamples(db,now);return;}
 const date=lifeosDay(now.getTime(),'America/Toronto'),stamp=now.toISOString(),objects=new LocalObjects(db,owner);
 const rec=async(kind:string,id:string,data:any)=>db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind(kind,id,JSON.stringify(data),1,stamp,stamp).run();
 if(!demo){await rec('settings','preferences',{timezone:'UTC'});await db.prepare('INSERT INTO meta VALUES(?,?)').bind('local-initialized','true').run();return;}
 const delta=Date.parse(date+'T12:00Z')-Date.parse(STORY_DAY+'T12:00Z');
 const shift=(v:any):any=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(v)?new Date(Date.parse(v.length===10?v+'T12:00Z':v)+delta).toISOString().slice(0,v.length===10?10:24):Array.isArray(v)?v.map(shift):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,shift(x)])):v;
 for(const [kind,rows] of Object.entries(scenarioRecords()) as [string,any[]][])
  for(const row of rows)await rec(kind,row.id,shift(kind==='settings'?{timezone:'America/Toronto'}:kind==='task'?{...row.data,difficulty:row.data.difficulty??3}:row.data));
 for(const event of scenarioEvents('overlap'))await rec('calendar-event',event.id,shift({...event,start:{dateTime:event.start},end:{dateTime:event.end},courseId:event.calendarId==='demo-school'?'demo-course-design':undefined}));
 await rec('task','demo-prelab',{title:'Systems pre-lab checklist',sourceUrl:'/demo/sources/lab.html',courseId:'demo-course-design',dueDate:date,estimatedMinutes:10,remainingMinutes:10,difficulty:2,status:'todo',nextStep:'Pack safety goggles and your lab notebook, then check the pre-lab instructions.'});
 await assignmentExamples(db,stamp,rec);
 await rec('calendar-event','demo-lab',{title:'Systems lab',calendarId:'demo-school',start:{dateTime:new Date(now.getTime()+10*60000).toISOString()},end:{dateTime:new Date(now.getTime()+70*60000).toISOString()},location:'Room S-204',description:'Bring safety goggles and your lab notebook. Complete the pre-lab checklist before arriving.'});

 await rec('profile','local-user',{name:DEMO_NAME,fictional:true});
 await rec('learning-note','demo-feedback',{type:'concept',courseId:'demo-course-design',title:'Feedback loop',text:'A feedback loop returns information about a system output to influence future inputs.',status:'learning',linkedIds:[],studyItemIds:[],authority:'owner-study-note'});
 await rec('private-note-folder','demo-folder',{title:'Class notes'});
 await rec('private-note','demo-note',{title:'Systems vocabulary',folderId:'demo-folder',imageIds:[],text:'A system is a set of interacting parts. Feedback uses an output to influence an input.',document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'A system is a set of interacting parts. Feedback uses an output to influence an input.'}]}]},pinned:true});
 await rec('private-friend','demo-maya',{name:'John Doe',text:'Fictional study group partner. Ask about the community garden.',memories:[],schedule:{frequency:'weekly',weekday:2},dueDay:date,archived:false});
 await rec('private-journal-template','demo-template',{name:'Daily reflection',questions:[{id:'highlight',prompt:'What did you learn today?'},{id:'next',prompt:'What would you like to try tomorrow?'}]});
 await rec('private-journal','demo-journal',{day:date,title:'A small step forward',templateId:'demo-template',templateName:'Daily reflection',answers:[{id:'highlight',prompt:'What did you learn today?',text:'Fictional entry: sketching one loop made a complex system easier to explain.'},{id:'next',prompt:'What would you like to try tomorrow?',text:'Bring two questions to the study group.'}]});
 await rec('devotional',date,{date,passage:'Psalm 23',bookId:'psalms',chapter:23,type:'standard',points:Array(7).fill(''),complete:false,archiveStatus:'not-needed'});
 for(const row of prayerExamples())await rec('prayer-note',row.id,row.data);
 await rec('reminder-list','personal',{title:'Personal',type:'list',order:0,pinned:true,archived:false});
 await rec('reminder-list','demo-groceries',{title:'Groceries',type:'grocery',order:1,staples:[{title:'Rolled oats',section:'Pantry'},{title:'Red lentils',section:'Pantry'}],archived:false});
 await rec('reminder','demo-oats',{title:'Rolled oats',listId:'demo-groceries',completed:false,notes:'1 bag',tags:[],subtasks:[],priority:0,flagged:false,section:'Pantry',order:0,archived:false});
 await rec('reminder','demo-lentils',{title:'Red lentils',listId:'demo-groceries',completed:false,notes:'1 pack',tags:[],subtasks:[],priority:0,flagged:false,section:'Pantry',order:1,archived:false});
 await rec('meal','demo-recipe',{title:'Lentil garden soup',slot:'recipe',steps:[{text:'Simmer rinsed red lentils, carrots and chopped tomato in vegetable stock.',minutes:20},{text:'Season to taste and serve with bread.',minutes:null}],recipe:'Simmer rinsed red lentils, carrots and chopped tomato in vegetable stock for 20 minutes. Season to taste. Serve with bread.',ingredients:['1 cup red lentils','2 carrots','1 tomato','3 cups vegetable stock'],notes:'Fictional recipe. Adjust ingredients to your needs.'});
 await rec('project','demo-project',{title:'Build a balcony planter',category:'personal-project',notes:'Design a small self-watering planter from reusable materials.',nextStep:'Sketch the container and water reservoir.',status:'active',archived:true});
 for(const row of publicProjectRecords())await rec('project',row.id,row.data);
 await rec('coop-role','demo-role',{title:'Community design intern',employer:'Example Studio',status:'researching',notes:'Fictional opportunity for exploring a portfolio.',sourceUrl:'https://example.invalid/opportunities',draftText:'',archived:false});
 await rec('coop-profile','owner',{name:DEMO_NAME,interests:['Community design','Practical systems'],locationPreferences:['Fictional city'],resume:{sourceId:'fictional-resume',name:'Authored fictional resume',text:'Alex Morgan — fictional student. Experience: designed a balcony planter prototype and explained feedback loops in a peer study group.',sourceUrl:'https://example.invalid/resume',importedAt:stamp}});
 await rec('finance-config','budget',{diningWeekly:6000,diningWantsWeekly:2000,shoppingMonthly:8000,bigQuarterly:18000,quarterAnchor:date.slice(0,4)+'-01-01',balanceAsOf:date.slice(0,7)+'-01',balances:{needs:200000,wants:100000,giving:20000,medical:0},horizon:(Number(date.slice(0,4))+1)+'-04-30',givingMonthly:[{name:'Community fund',amountCents:2000}],medicalOutsideBudget:true,reconciledThrough:date});
 await rec('finance-transaction','demo-lunch',{date,description:'Fictional campus lunch',amountCents:1250,category:'dining',account:'Demo account',ledger:{needs:500,wants:750,giving:0,medical:0},source:'manual'});
 await rec('training','baseline',demoTraining(date));
 await rec('reminder','demo-maya-contact',{title:'Check in with John Doe',listId:'personal',dueDate:date,completed:false,notes:'Fictional weekly check-in',tags:[],subtasks:[],priority:1,flagged:false,order:0,archived:false});
 const lectureId='lc-'+sha('demo-course-design').slice(0,16)+'-fictional';
 const start=new Date(now.getTime()-3600000).toISOString();
 await rec('lecture-permission','demo-course-design',{courseId:'demo-course-design',state:'approved-by-owner-confirmation',confirmedAt:stamp});
 await rec('lecture',lectureId,{courseId:'demo-course-design',title:'Introduction to feedback loops',startedAt:start,endedAt:stamp,lifeosDay:date,recordingStatus:'available',savedSegments:1,expectedSegments:1,materialIds:[],noteDocumentId:lectureId,recordingId:lectureId,transcriptStatus:'transcribed',processingStatus:'outline-ready',lastOffsetMs:6000});
 const makeStroke=(id:string,coords:number[][],offset:number)=>({id,pageId:'0001',width:3,color:'#172b3d',startedAtOffsetMs:offset,endedAtOffsetMs:offset+500,epochId:'demo-epoch',createdAt:stamp,audioSegmentId:'0000',points:coords.map(([x,y],i)=>({x,y,pressure:0.5,tiltX:0,tiltY:0,offsetMs:offset+Math.round(i*500/(coords.length-1))}))});
 const page={schemaVersion:1,width:1000,height:1400,strokes:[makeStroke('demo-input',[[120,180],[350,180],[350,320],[120,320],[120,180]],1000),makeStroke('demo-output',[[620,180],[850,180],[850,320],[620,320],[620,180]],2000),makeStroke('demo-forward',[[350,250],[620,250],[595,230],[620,250],[595,270]],3000),makeStroke('demo-loop',[[730,320],[730,440],[230,440],[230,320],[210,340],[230,320],[250,340]],4000)],attachments:[]};
 const objectKey='lecture-page:'+lectureId+'-p-0001';const content=JSON.stringify(page);const pageFile='demo-page-file';await objects.put(pageFile,{name:'Fictional lecture page',parents:['local-uploads'],mimeType:'application/json'},Buffer.from(content));
 await db.prepare('INSERT INTO private_objects VALUES(?,?,?,?,?,?,1)').bind(objectKey,pageFile,sha(content),Buffer.byteLength(content),'application/json','local-uploads').run();
 await rec('lecture-page',lectureId+'-p-0001',{lectureId,pageId:'0001',objectKey,sha256:sha(content),strokes:page.strokes.length,lastOffsetMs:4500});
 const audio=await load('public/demo-lecture.wav'),audioId='demo-audio-file',clipId=lectureId+'-a-0000';await objects.put(audioId,{name:'Fictional spoken lecture',parents:['local-uploads'],mimeType:'audio/wav'},audio);
 await db.prepare('INSERT INTO chunks VALUES(?,?,?,?,?,?)').bind(clipId,0,sha(audio),audioId,audio.length,'audio/wav').run();
 await rec('upload-manifest',clipId,{title:'Synthetic timing audio',cloudChunks:true,mimeType:'audio/wav',totalChunks:1,totalSize:audio.length,lectureId});
 await rec('lecture-clip',clipId,{lectureId,id:'0000',recordingId:clipId,startMs:0,endMs:6000,wallAt:start,epochId:'demo-epoch',mimeType:'audio/wav',status:'saved',mediaDurationMs:6000});
 await rec('lecture-study-item',lectureId+'-s-definition',{lectureId,courseId:'demo-course-design',type:'glossary',term:'Feedback',definition:'Information about a system output that influences later input.',text:'Information about a system output that influences later input.',stage:'learning',uncertain:false});
 for(const [suffix,question,answer,recall] of [['input','What is an input?','Information or energy entering a system.',0],['feedback','What does Feedback do?','An output influences the next input.',1]])await rec('lecture-study-item',lectureId+'-s-recall-'+suffix,{type:'recall',lectureId,courseId:'demo-course-design',question,answer,recall,evidence:'Authored fictional study card.'});
 await rec('lecture-transcript',lectureId,{lectureId,text:'Mock transcript: a feedback loop returns information about an output to influence a future input. Negative feedback reduces a deviation. Positive feedback amplifies it.',segments:[{startMs:0,endMs:6000,text:'A feedback loop returns information about an output to influence a future input.'}],mock:true});
 
 for(const [id,parent,name] of [['fictional-term-folder','local-uploads','Fictional term'],['fictional-course-folder','fictional-term-folder','Systems design'],['fictional-slides-folder','fictional-course-folder','Slides']])await objects.put(id,{name,parents:[parent],mimeType:'application/vnd.google-apps.folder'},new Uint8Array());
 await rec('course-library','demo-course-design',{courseId:'demo-course-design',folderId:'fictional-course-folder',termFolderId:'fictional-term-folder',sections:{Slides:'fictional-slides-folder'},lastLearnCheck:stamp});
 const slides=await load('public/demo-slides.pdf'),slidesId='fictional-slide-file';const slidesMeta=await objects.put(slidesId,{name:'Feedback loops — fictional slides',parents:['fictional-slides-folder'],mimeType:'application/pdf',modifiedTime:stamp},slides);
 await rec('lecture-source',lectureId+'-s-slides',{lectureId,fileId:slidesId,title:'Feedback loops — fictional slides',mimeType:'application/pdf',size:slides.length,modifiedTime:stamp,md5:slidesMeta.md5Checksum,role:'slides',timing:'unmapped',durationMs:null});
 await rec('lecture-course-source','demo-course-design-slides',{courseId:'demo-course-design',fileId:slidesId,title:'Feedback loops — fictional slides',mimeType:'application/pdf',size:slides.length,modifiedTime:stamp,md5:slidesMeta.md5Checksum,role:'slides',timing:'unmapped',durationMs:null,fromDay:date,throughDay:date});
 await rec('course-lesson','demo-course-design-lesson-intro',{courseId:'demo-course-design',title:'Feedback loops',sourceIds:['demo-course-design-slides'],pageRange:{from:1,through:2}});
 await rec('training-source','fictional-plan',createDemoMarathonSource());

 // A drawn fictional landscape, generated locally; no real photograph is used.
 const image=await load('public/demo-landscape.jpg');const imageUrl='data:image/jpeg;base64,'+image.toString('base64'),photo=JSON.stringify({image:imageUrl,thumbnail:imageUrl,width:640,height:360});
 for(const [key,value] of [['demo-photo',photo],['demo-photo-thumb',JSON.stringify({thumbnail:imageUrl})]]){
  await objects.put(key,{name:'Fictional landscape',parents:['local-uploads'],mimeType:'application/json'},Buffer.from(value));await db.prepare('INSERT INTO private_objects VALUES(?,?,?,?,?,?,1)').bind(key,key,sha(value),Buffer.byteLength(value),'application/json','local-uploads').run();
 }
 await rec('private-daily-photo','demo-photo',{day:date,caption:'Fictional landscape illustration — a quiet afternoon.',objectKey:'demo-photo',thumbnailKey:'demo-photo-thumb',width:640,height:360});
 await db.prepare('INSERT INTO meta VALUES(?,?)').bind('release-catalogue',JSON.stringify({releases:[{releaseId:'beta-0000000000000001',title:'Fictional local release',summary:'Mock release for reviewing the update workflow. No deployment is performed.',version:'0.1.0',betaUrl:'#settings',canPromote:true,canDeployBeta:true,canRollback:true}],current:{production:null,beta:'beta-0000000000000001'},betaUrl:'#settings'})).run();
 await db.prepare('INSERT INTO meta VALUES(?,?)').bind('demo-content-revision',DEMO_REVISION).run();
 await db.prepare('INSERT INTO meta VALUES(?,?)').bind('local-initialized','true').run();
}

const DEMO_REVISION='2026-10-22-content-v2';
function demoTraining(date:string){const start=new Date(date+'T12:00Z');start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7)+17*7+6);return {raceDate:start.toISOString().slice(0,10),goalMinutes:DEMO_MARATHON_GOAL_MINUTES,notes:'Hansons Beginner Marathon · 18 weeks. Example goal: 4 hours. Keep the published workout days and mileage; adjust to your own training history.'};}
function prayerExamples(){return [
 ['demo-thanks','thanksgiving','Gratitude','Give thanks for daily provision, friendship and opportunities to learn.'],
 ['demo-repentance','repentance','Patience and honesty','Ask for help to speak kindly, admit mistakes and make things right.'],
 ['demo-prayer','daily-others','For the community','Pray for neighbours who need shelter, food, safety or companionship.'],
 ['demo-daily-bread','daily-bread','Wisdom for today','Ask for focus in work and study, rest, and wisdom in everyday decisions.'],
 ['demo-regular','regular-others','Family and friends','Pray for good health, encouragement and support for those caring for others.'],
 ['demo-spontaneous','spontaneous-others','People facing hardship','Remember people affected by conflict, disasters or unexpected loss.']
 ].map(([id,section,title,text])=>({id,data:{section,title,text,weekdays:[],archived:false}}));}
async function assignmentExamples(db:WorkspaceDatabase,stamp:string,rec:(kind:string,id:string,data:any)=>Promise<any>,refresh=false){
 const known=new Set([...scenarioRecords().task.map(r=>r.id),'demo-prelab']);
 const tasks=(await db.prepare("SELECT * FROM records WHERE kind='task'").all()).results.filter(r=>known.has(r.id)).map(r=>({...r,id:String(r.id),version:Number(r.version),data:JSON.parse(r.data)}));
 // Finish the shared course-material set before hashing any assignment brief.
 for(const task of tasks){const id='demo-instructions-'+task.id;if(await db.prepare("SELECT id FROM records WHERE kind='material' AND id=?").bind(id).first())continue;await rec('material',id,{title:'Fictional assignment instructions',courseId:task.data.courseId,taskId:task.id,text:task.id==='demo-prelab'?'Fictional lab instructions: complete the pre-lab checklist, pack safety goggles and your lab notebook, and arrive in Room S-204.':'Fictional instructions: identify the inputs and outputs of one familiar system, draw a feedback loop, and explain your reasoning in your own words.',url:task.data.sourceUrl,coverage:'full-text'});}
 const materials=(await db.prepare("SELECT * FROM records WHERE kind='material' ORDER BY updated_at DESC,id").all()).results.map(r=>({...r,id:String(r.id),version:Number(r.version),data:JSON.parse(r.data)}));
 if(refresh&&materials.some(r=>r.version>1))return; // Authored briefs must not replace a visitor's source work.
 for(const task of tasks){const old=await db.prepare("SELECT version FROM records WHERE kind='assignment-brief' AND id=?").bind(task.id).first();if(refresh&&(old?.version>1||task.version>1&&!await db.prepare("SELECT id FROM _demo_seed_originals WHERE revision=? AND kind='task' AND id=?").bind(DEMO_REVISION,task.id).first()))continue;const c=await db.prepare("SELECT * FROM records WHERE kind='course' AND id=?").bind(task.data.courseId).first();if(!c)continue;const sources=assignmentSources(task,materials),sourceHash=sha(JSON.stringify({title:task.data.title,dueDate:task.data.dueDate,dueAt:task.data.dueAt,sources:sources.map(({version,...v})=>v)})),brief=assignmentBundle(task,{...c,data:JSON.parse(c.data)}).brief;await rec('assignment-brief',task.id,{...brief,summary:'Mock outline: '+brief.summary,sourceHash,generatedAt:stamp});}
}
/** Upgrade only untouched, known fictional examples. Every replaced row is retained locally. */
async function refreshDemoExamples(db:WorkspaceDatabase,now:Date){
 if(await db.prepare("SELECT value FROM meta WHERE key='demo-content-revision' AND value=?").bind(DEMO_REVISION).first())return;
 const profile=await db.prepare("SELECT * FROM records WHERE kind='profile' AND id='local-user'").first();if(!profile||JSON.parse(profile.data).fictional!==true)return;
 const date=lifeosDay(Date.parse(profile.created_at),'America/Toronto'),stamp=now.toISOString(),delta=Date.parse(date+'T12:00Z')-Date.parse(STORY_DAY+'T12:00Z');
 const shift=(v:any):any=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(v)?new Date(Date.parse(v.length===10?v+'T12:00Z':v)+delta).toISOString().slice(0,v.length===10?10:24):Array.isArray(v)?v.map(shift):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,shift(x)])):v;
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec('CREATE TABLE IF NOT EXISTS _demo_seed_originals(revision TEXT,kind TEXT,id TEXT,data TEXT,version INTEGER,created_at TEXT,updated_at TEXT,PRIMARY KEY(revision,kind,id))');
  const get=async(kind:string,id:string)=>db.prepare('SELECT * FROM records WHERE kind=? AND id=?').bind(kind,id).first();
  const put=async(kind:string,id:string,data:any)=>{if(await db.prepare('SELECT id FROM retired_records WHERE kind=? AND id=?').bind(kind,id).first())return;const old=await get(kind,id);if(old){if(old.version!==1||old.data===JSON.stringify(data))return;await db.prepare('INSERT OR IGNORE INTO _demo_seed_originals VALUES(?,?,?,?,?,?,?)').bind(DEMO_REVISION,kind,id,old.data,old.version,old.created_at,old.updated_at).run();await db.prepare('UPDATE records SET data=?,version=version+1,updated_at=? WHERE kind=? AND id=? AND version=1').bind(JSON.stringify(data),stamp,kind,id).run();}else await db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind(kind,id,JSON.stringify(data),1,stamp,stamp).run();};
  for(const row of scenarioRecords().task){const old=await get('task',row.id);if(!old||JSON.parse(old.data).title===row.data.title)await put('task',row.id,shift({...row.data,difficulty:row.data.difficulty??3}));}
  const friend=await get('private-friend','demo-maya');if(friend&&JSON.parse(friend.data).name==='Maya Chen')await put('private-friend','demo-maya',{...JSON.parse(friend.data),name:'John Doe'});
  const contact=await get('reminder','demo-maya-contact');if(contact&&JSON.parse(contact.data).title==='Check in with Maya Chen')await put('reminder','demo-maya-contact',{...JSON.parse(contact.data),title:'Check in with John Doe'});
  const oldPoints=['Notice something good.','Consider the context.','Reflect on kindness.','Name a human need.','Choose one practical act.','Listen with care.','Take a quiet moment.'];
  for(const r of (await db.prepare("SELECT * FROM records WHERE kind='devotional'").all()).results){const d=JSON.parse(r.data);if(JSON.stringify(d.points)===JSON.stringify(oldPoints)&&d.complete===false)await put('devotional',r.id,{...d,points:Array(7).fill('')});}
  const legacy=await get('project','demo-project');if(legacy&&JSON.parse(legacy.data).title==='Build a balcony planter')await put('project','demo-project',{...JSON.parse(legacy.data),archived:true});
  for(const row of publicProjectRecords())if(!await get('project',row.id))await put('project',row.id,row.data);
  for(const row of prayerExamples())if(!await get('prayer-note',row.id))await put('prayer-note',row.id,row.data);
  const baseline=await get('training','baseline');if(baseline&&JSON.parse(baseline.data).notes==='Fictional fitness plan; edit for your own ability.')await put('training','baseline',demoTraining(date));
  const source=await get('training-source','fictional-plan');if(source&&JSON.parse(source.data).source?.title==='Fictional gentle activity reference')await put('training-source','fictional-plan',createDemoMarathonSource());
  await assignmentExamples(db,stamp,put,true);
  await db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').bind('demo-content-revision',DEMO_REVISION).run();db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
