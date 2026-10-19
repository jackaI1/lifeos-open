import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,realpath,open,link,unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {AppError,hash} from './store.mjs';
import {createAuth,equal} from './auth.mjs';
import {publicValue,safeJob,publicRecords,devotionalView,zone,observation,completionFields,syncDevotional,progress,actionResult} from '../shared/application.mjs';
const routesReadKinds=new Set(v.readableKinds);
import {releaseCatalogue,validateReleaseRequest} from './releases.mjs';
import {listDevices,createDevice,revokeDevice,receivePresence} from './devices.mjs';
import {syncCoopTask} from './coop-tasks.mjs';
import * as v from './validation.mjs';
import {buildToday,spendTicket,undoTicket,reassessTaskProgress,normalizeDomainSettings,buildDayPlan,buildTrainingReference,normalizeCalendars,localDate,addDays} from '../domain/index.mjs';

const json=(res,body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
async function bytes(req,limit){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw new AppError('Request is too large',413);chunks.push(chunk);}return Buffer.concat(chunks);}
async function body(req){if(!req.headers['content-type']?.startsWith('application/json'))throw new AppError('JSON required',415);try{return v.object(JSON.parse((await bytes(req,1024*1024)).toString('utf8')));}catch(e){if(e instanceof AppError)throw e;throw new AppError('Invalid JSON');}}
async function containedFile(config,path){const root=await realpath(config.dataDir),file=await realpath(path),rel=relative(root,file);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new AppError('Saved file is unavailable',404);return file;}

async function prepareUpload(store,config,b){
 const sid=v.identifier(b.sessionId),total=v.number(b.totalChunks,1,10001);if(!Number.isInteger(total))throw new AppError('Whole chunk count required');v.enumValue(b.kind,['prayer','coursework','attachment']);
 const title=v.text(b.title??'Recording',300),taskId=b.taskId?v.identifier(b.taskId):null;if(taskId&&!store.get('task',taskId))throw new AppError('Task not found',404);
 const sections=b.sections??[];if(!Array.isArray(sections)||sections.length>500)throw new AppError('Too many section markers');for(const marker of sections){v.exactFields(marker,['section','atMs']);v.number(marker.section,0,5);if(!Number.isInteger(marker.section))throw new AppError('Invalid prayer section');v.number(marker.atMs,0,24*3600000);}
 const startedAt=b.startedAt?observation(b.startedAt,null,store):null,endedAt=b.endedAt?observation(b.endedAt,null,store):null;if(startedAt&&endedAt&&endedAt<startedAt)throw new AppError('Recording end precedes its start');
 const fingerprint=hash(JSON.stringify({kind:b.kind,total,title,taskId,sections,startedAt,endedAt}));const prior=store.get('upload-manifest',sid);if(prior){if(prior.data.fingerprint!==fingerprint)throw new AppError('This upload has already been finalized differently',409);return {prior};}
 const rows=store.db.prepare('SELECT * FROM chunks WHERE session_id=? ORDER BY chunk_index').all(sid);if(rows.length!==total||rows.some((r,i)=>r.chunk_index!==i))throw new AppError('Some chunks have not reached the server',409,'upload_incomplete');
 const mime=rows[0].mime_type;if(rows.some(r=>r.mime_type!==mime)||(b.mimeType&&String(b.mimeType).split(';')[0]!==mime))throw new AppError('Upload formats disagree');const size=rows.reduce((sum,row)=>sum+row.size,0);if(size>(b.kind==='prayer'?1024*1024*1024:50*1024*1024))throw new AppError('Upload exceeds the size limit',413);
 let destination=null,staging=null,handle;const digest=createHash('sha256');let sha256;try{if(b.kind!=='prayer'){await mkdir(join(config.dataDir,'files'),{recursive:true});destination=join(config.dataDir,'files',sid+'.bin');staging=join(config.dataDir,'files',sid+'-'+randomUUID()+'.pending');handle=await open(staging,'wx');}
 for(const row of rows){const chunk=await readFile(await containedFile(config,row.path));if(chunk.length!==row.size||hash(chunk)!==row.sha256)throw new AppError('Stored upload failed its integrity check',409,'upload_integrity');digest.update(chunk);if(handle)await handle.writeFile(chunk);}sha256=digest.digest('hex');if(handle){await handle.sync();await handle.close();handle=null;await link(staging,destination).catch(error=>{if(error.code!=='EEXIST')throw error;});if(hash(await readFile(await containedFile(config,destination)))!==sha256)throw new AppError('Assembled file failed its integrity check',409,'upload_integrity');}}finally{await handle?.close();if(staging)await unlink(staging).catch(()=>{});}
 return {sid,title,taskId,sections,total,mime,size,sha256,destination,fingerprint,startedAt,endedAt};
}

export function createApp(store,config,{verifyIdToken}={}){
 if(!config.gatewaySecret||config.gatewaySecret.length<32||!config.googleClientId||!config.allowedEmail||!config.origin?.startsWith('https://'))throw new Error('Private authentication configuration is incomplete');
 const auth=createAuth(store,config,{verifyIdToken});const limits=new Map();let capacityCache={};
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), geolocation=(), microphone=(self)');
  try{
   if(!equal(req.headers['x-lifeos-gateway'],config.gatewaySecret))throw new AppError('Unauthorized',401);
   if(req.headers['x-lifeos-origin']!==config.origin)throw new AppError('Origin denied',403);
   const url=new URL(req.url,config.origin),path=url.pathname;
   if(store.meta('migrationQuiesced')&&(path.startsWith('/auth/')||!['GET','HEAD'].includes(req.method)))throw new AppError('This recovered local store is read-only. Use the cloud LifeOS address.',503,'migration_read_only');
   if(req.url.length>2048||/%(?:2e|2f|5c|00)/i.test(req.url)||path.includes('\\')||path.includes('..'))throw new AppError('Invalid path',400);
   const key=String(req.headers['x-lifeos-client']??'unknown').slice(0,100),now=Date.now();const rate=limits.get(key);if(!rate||rate.until<now)limits.set(key,{n:1,until:now+60000});else if(++rate.n>300)throw new AppError('Too many requests. Try again shortly.',429,'rate_limit');if(limits.size>2000)for(const[k,r]of limits)if(r.until<now)limits.delete(k);
   if(path==='/auth/login'&&req.method==='GET'){const login=auth.login();res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Set-Cookie',`__Host-lifeos-login=${login.nonce}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`);return res.end(login.html);}
   if(path==='/auth/google'&&req.method==='GET'){let result;try{result=await auth.googleCode(req,url.searchParams);}catch{throw new AppError('Google sign-in verification failed. Please retry.',403,'google_auth');}res.writeHead(303,{'Location':'/','Set-Cookie':[result.cookie,'__Host-lifeos-login=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0']});return res.end();}
   if(path==='/auth/google'&&req.method==='POST'){let result;try{result=await auth.google(req,(await bytes(req,16384)).toString('utf8'));}catch(e){if(e instanceof AppError)throw e;throw new AppError('Google sign-in verification failed. Please retry.',403,'google_auth');}res.writeHead(303,{'Location':'/','Set-Cookie':[result.cookie,'__Host-lifeos-login=; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=0']});return res.end();}
   if(path==='/api/presence'&&req.method==='POST'){if(config.environment!=='production')throw new AppError('Device presence is disabled in beta',403);return json(res,receivePresence(store,req,await body(req)));}
   const session=auth.session(req);if(!session)throw new AppError('Authentication required',401,'unauthorized');
   if(path==='/internal/authorize'&&req.method==='GET')return json(res,{authorized:true});
   if(req.method!=='GET'&&req.method!=='HEAD')auth.csrf(req,session);
   if(path==='/api/session'&&req.method==='GET')return json(res,{email:session.email,csrf:session.csrf,environment:config.environment,version:config.version});
   if(path==='/api/releases'&&req.method==='GET')return json(res,await releaseCatalogue(config));
   if(path==='/api/devices'&&req.method==='GET')return json(res,{devices:listDevices(store)});
   if(path==='/api/devices'&&req.method==='POST'){if(config.environment!=='production')throw new AppError('Device setup is disabled in beta',403);return json(res,createDevice(store,await body(req)),201);}
   if(path==='/api/devices/revoke'&&req.method==='POST')return json(res,revokeDevice(store,await body(req)));
   if(path==='/api/actions/release'&&req.method==='POST'){const b=await body(req);v.exactFields(b,['mutationId','action','releaseId','expectedCurrentRelease','intentional']);const payload=await validateReleaseRequest(config,b);return json(res,store.mutate(v.mutationId(b.mutationId),{path,b},()=>({job:safeJob(store.enqueue('maintenance-release',payload,{priority:2,authority:'authenticated-release-action'}))})),202);}
   if(path==='/api/bootstrap'&&req.method==='GET'){
    const records=publicRecords(store);delete records.devotional;delete records['devotional-import'];delete records['support-message'];
    const prefs=store.get('settings','preferences')?.data??{},instant=new Date().toISOString(),date=localDate(instant,zone(store));const events=(records['calendar-event']??[]).map(r=>({...r.data,id:r.id}));const settings=normalizeDomainSettings({...prefs,allowedCalendarIds:Object.values(config.calendarIds??{}),schoolCalendarIds:[config.calendarIds?.schoolA,config.calendarIds?.schoolB].filter(Boolean),presenceCorrections:(records['presence-correction']??[]).map(r=>({...r.data,id:r.id}))});
    const cacheKey=hash(JSON.stringify([date,settings,records['calendar-event'],records.spiritual]));if(capacityCache.key!==cacheKey){const calendar=normalizeCalendars({events,...settings});const academicCapacity=[];for(let index=0;index<120;index++){const day=addDays(date,index),spiritual=Object.fromEntries((records.spiritual??[]).filter(r=>r.data.date===day).map(r=>[r.data.practice,r.data]));academicCapacity.push(...buildDayPlan({date:day,now:instant,events:calendar.busy,settings,spiritual}).academicBlocks);}capacityCache={key:cacheKey,academicCapacity};}settings.academicCapacity=capacityCache.academicCapacity;
    const today=buildToday({now:instant,records:{...records,presence:(records.presence??[]).filter(r=>!r.data.archived&&!r.data.undone)},events,settings}),training=records.training?.[0]?.data??{},source=records['training-source']?.[0]?.data;let trainingPlan={status:'source-needed',workouts:[],issues:['A verified training source and race date are required.']};if(source?.sourceWeeks&&training.raceDate){try{trainingPlan={...buildTrainingReference({raceDate:training.raceDate,sourceWeeks:source.sourceWeeks,program:source.program??'Beginner',raceExceptionConfirmed:training.sundayExceptionConfirmed===true}),source:source.source};}catch{trainingPlan={status:'source-review-needed',workouts:[],issues:['The imported source table needs review before it can be placed on the race calendar.']};}}
    return json(res,{date,now:instant,environment:config.environment,version:config.version,records,jobs:store.jobs().map(safeJob),integrations:records.integration??[],today,trainingPlan});
   }
   const match=path.match(/^\/api\/records\/([-\w]+)(?:\/([-\w]+))?$/);
   if(match){const[,kind,id]=match;if(!routesReadKinds.has(kind))throw new AppError('Not found',404);if(req.method==='GET'){if(!id)return json(res,{items:publicValue(store.list(kind,{limit:Math.min(1000,Math.max(1,Math.floor(Number(url.searchParams.get('limit'))||500))),offset:Math.max(0,Math.floor(Number(url.searchParams.get('offset'))||0))}))});const item=store.get(kind,id);if(!item)throw new AppError('Not found',404);return json(res,{item:publicValue(item)});}if(req.method==='PUT'&&id){const b=await body(req);v.identifier(id);v.version(b.version);const data=v.recordData(kind,b.data);return json(res,store.mutate(v.mutationId(b.mutationId),{path,b},()=>{const old=store.get(kind,id),item=store.put(kind,id,{...old?.data,...data},b.version);if(kind==='coursework'&&item.data.taskId)progress(store,item.data.taskId,{id:item.id+':'+item.version,type:'saved-draft',at:item.updatedAt,recordId:item.id});if(kind==='coop-role')syncCoopTask(store,item);return {item:publicValue(item)};}));}}
   if(path==='/api/devotionals'&&req.method==='GET')return json(res,{entries:store.list('devotional').map(r=>devotionalView(store,r)),importedCount:store.db.prepare("SELECT count(*) AS n FROM records WHERE kind='devotional-import'").get().n});
   const devo=path.match(/^\/api\/devotionals\/(\d{4}-\d{2}-\d{2})$/);
   if(devo){const date=v.date(devo[1]);const old=store.get('devotional',date);if(req.method==='GET')return json(res,{entry:old?devotionalView(store,old):{date,points:Array(7).fill(''),passage:'',readingPlan:'',complete:false,completedAt:null,version:0,updatedAt:null,archiveStatus:'not-needed'}});if(req.method==='PUT'){const b=await body(req),clean=v.devotional(b);return json(res,store.mutate(v.mutationId(b.mutationId),{path,b},()=>{const current=store.get('devotional',date),completion=completionFields(clean,current?.data,date,store);delete clean.observedAt;const item=store.put('devotional',date,{...current?.data,...clean,date,...completion,archiveStatus:clean.complete?'queued':current?.data.archiveStatus??'not-needed'},b.version);syncDevotional(store,item);if(clean.complete)store.enqueue('devotional-archive',{date,version:item.version},{priority:6,authority:'archive-policy'});return {entry:devotionalView(store,item)};}));}}
   if(path==='/api/jobs'&&req.method==='GET')return json(res,{jobs:store.jobs().map(safeJob)});
   if(path==='/api/jobs'&&req.method==='POST'){const b=await body(req),job=v.jobRequest(b);if(store.meta('automationPaused')&&job.type!=='support')throw new AppError('Automation is paused',409,'paused');return json(res,store.mutate(v.mutationId(b.mutationId),{path,b},()=>{for(const id of job.payload.attachmentIds??[])if(!store.get('attachment',id))throw new AppError('Attachment not found',404);const kind={support:'support-thread',inspire:'task','coop-draft':'coop-role','prayer-process':'prayer-session'}[job.type],recordId=job.payload.threadId??job.payload.taskId??job.payload.roleId??job.payload.sessionId;if(kind&&!store.get(kind,recordId))throw new AppError('The requested record was not found',404);if(job.type==='coop-draft'&&store.get(kind,recordId)?.data.archived)throw new AppError('This role is archived',409);if(job.type==='support'){const msgId=randomUUID();store.put('support-message',msgId,{threadId:job.payload.threadId,role:'user',text:job.payload.message,attachmentIds:job.payload.attachmentIds??[]},0);job.payload.messageId=msgId;}return {job:safeJob(store.enqueue(job.type,job.payload,{priority:['support','inspire','coop-draft'].includes(job.type)?1:job.type==='maintenance'?8:5,authority:job.type==='maintenance'?'authenticated-intentional-report':'owner'}))};}),202);}
   const jobMatch=path.match(/^\/api\/jobs\/([-\w]+)(\/cancel)?$/);
   if(jobMatch){const job=store.job(jobMatch[1]);if(!job)throw new AppError('Job not found',404);if(req.method==='GET'&&!jobMatch[2])return json(res,{job:safeJob(job)});if(req.method==='POST'&&jobMatch[2]){const b=await body(req);return json(res,store.mutate(v.mutationId(b.mutationId),{path,b},()=>{store.cancel(job.id);return {job:safeJob(store.job(job.id))};}));}}
   const upload=path.match(/^\/api\/uploads\/([-\w]+)\/(\d+)$/);
   if(upload&&req.method==='POST'){
    const sid=v.identifier(upload[1]),index=Number(upload[2]);if(index>10000)throw new AppError('Too many chunks');v.mutationId(req.headers['x-mutation-id']);const data=await bytes(req,8*1024*1024),digest=hash(data);if(req.headers['x-content-sha256']!==digest)throw new AppError('Upload checksum does not match',400);const mime=String(req.headers['content-type']??'application/octet-stream').split(';')[0];if(!['audio/webm','audio/mp4','audio/ogg','audio/wav','application/pdf','text/plain','image/png','image/jpeg','application/octet-stream'].includes(mime))throw new AppError('File format is not supported',415);
    const prior=store.db.prepare('SELECT * FROM chunks WHERE session_id=? AND chunk_index=?').get(sid,index);if(prior){if(prior.sha256!==digest)throw new AppError('A different chunk already exists',409);return json(res,{stored:true,sha256:digest,index});}
    if(store.get('upload-manifest',sid))throw new AppError('This upload is already finalized',409);
    if(store.db.prepare('SELECT COALESCE(sum(size),0) AS n FROM chunks WHERE session_id=?').get(sid).n+data.length>1024*1024*1024)throw new AppError('Recording exceeds the one-gigabyte limit',413);
    const directory=join(config.dataDir,'uploads',sid);await mkdir(directory,{recursive:true});const dest=join(directory,String(index)+'.chunk');await writeFile(dest,data,{flag:'wx'}).catch(async e=>{if(e.code!=='EEXIST'||hash(await readFile(dest))!==digest)throw e;});store.db.prepare('INSERT OR IGNORE INTO chunks VALUES(?,?,?,?,?,?)').run(sid,index,digest,dest,data.length,mime);return json(res,{stored:true,sha256:digest,index});
   }
   if(path.startsWith('/api/actions/')&&req.method==='POST'){
    const action=path.slice('/api/actions/'.length),b=await body(req);const id=v.mutationId(b.mutationId);
    if(action==='logout'){res.setHeader('Set-Cookie',auth.logout(req));return json(res,{ok:true});}
    const prepared=action==='upload-finalize'?await prepareUpload(store,config,b):null;
    return json(res,store.mutate(id,{path,b},()=>actionResult(action,b,store,config,prepared)));
   }
   const fileMatch=path.match(/^\/api\/files\/([-\w]+)$/);if(fileMatch&&req.method==='GET'){const manifest=store.get('upload-manifest',fileMatch[1]);if(!manifest?.data.assembledPath)throw new AppError('File not found',404);const filename=await containedFile(config,manifest.data.assembledPath);res.setHeader('Content-Type',manifest.data.mimeType??'application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename="lifeos-file"; filename*=UTF-8''${encodeURIComponent(manifest.data.title)}`);res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");await pipeline(createReadStream(filename),res);return;}
   if(path==='/api/push/config'&&req.method==='GET')return json(res,{configured:!!config.pushPublicKey,...(config.pushPublicKey?{publicKey:config.pushPublicKey}:{})});
   if(path==='/api/audit'&&req.method==='GET')return json(res,{items:store.db.prepare('SELECT id,kind,record_id AS recordId,created_at AS createdAt,actor,undo_of AS undoOf FROM audit ORDER BY created_at DESC LIMIT 100').all()});
   if(path==='/api/export'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="lifeos-export.json"');return json(res,{schemaVersion:1,exportedAt:new Date().toISOString(),environment:config.environment,records:publicRecords(store)});}
   if(path==='/api/health'&&req.method==='GET')return json(res,{status:'online',environment:config.environment,version:config.version,automationPaused:!!store.meta('automationPaused'),heartbeats:store.db.prepare('SELECT name,at,last_success FROM heartbeats').all()});
   throw new AppError('Not found',404);
  }catch(e){if(res.headersSent)return res.destroy();json(res,{error:e instanceof AppError?e.message:'The request failed. Your saved records are unchanged.',code:e instanceof AppError?e.code??'request_error':'server_error',...(e.current?{current:publicValue(e.current)}:{})},e.status??500);}
 });
 return {server,auth};
}

