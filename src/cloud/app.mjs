import {localCalendar} from './local-calendar.mjs';
import {httpsOrigin} from '../shared/service-config.mjs';
import {devotionalApplications} from './devotional-applications.mjs';
import {privateTravelBlocks,privateTravelRoute} from './private-travel.mjs';
import {privateNotesFriendsRoute} from './private-notes-friends.mjs';
import {deletedRoute} from './deleted.mjs';
import {privateMomentsRoute} from './private-moments.mjs';
import {operationWorldRoute} from './operation-world.mjs';
import {notificationHistory} from './notification-history.mjs';
import {databaseBudgetStatus} from './database-budget.mjs';
import {learningNotesRoute} from './learning-notes.mjs';
import {spiritualToolsRoute,stepCorrections} from './spiritual-tools.mjs';
import {replanningRoute} from './replanning.mjs';
import {taskToolsRoute} from './task-tools.mjs';
import {dueLectureReviews} from './lecture-study.mjs';
import {revisionRoute} from './revisions.mjs';
import {interactiveUsage} from '../shared/interactive-usage.mjs';
import {workspaceAsset} from './assets.mjs';
import {financeRoute} from './finances.mjs';
import {assistantRoute} from './assistant.mjs';
import {reminderRoute} from './reminders.mjs';
import {cookingHelpRoute} from './cooking-help.mjs';
import {lectureRoute} from './lectures.mjs';
import {scheduleEntryRoute} from './schedule-entry.mjs';
import {isRetiredProductionFixture} from '../shared/production-test-policy.mjs';
import {lifeosDay} from '../../public/lifeos-day.js';
import {CloudStore} from './store.mjs';import {CloudAuth} from './auth.mjs';import {AppError} from '../shared/errors.mjs';import {publicNotice} from '../public-notices.mjs';import {publicValue,publicRecords} from '../shared/application.mjs';import {recordRoute,loadPlan,jobList} from './records.mjs';import {boundedBytes,uploadChunk,reconcileFinalizedUpload,finalizeUpload,downloadFile} from './files.mjs';import {buildToday,normalizeDomainSettings,buildTrainingReference,localDate,addDays,zonedDateTime} from '../domain/index.mjs';import * as v from '../server/validation.mjs';
import {handoffRoute} from './handoff.mjs';
import {workerRoute} from './worker-api.mjs';import {quotaStatus} from './quota.mjs';
import {deviceRoute} from './devices.mjs';
import {scheduledTick} from './scheduled.mjs';
import {privateFile,googleFetch} from './google.mjs';
import {queuePersonalCalendar} from './calendar-write.mjs';
const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Strict-Transport-Security':'max-age=31536000','Permissions-Policy':'camera=(), geolocation=(self), microphone=(self)','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src https://widget.operationworld.org; connect-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'; manifest-src 'self'"};
function hardened(response){const headers=new Headers(response.headers);for(const [k,val]of Object.entries(security))if(!headers.has(k)||k!=='Content-Security-Policy')headers.set(k,val);return new Response(response.body,{status:response.status,headers});}
async function jsonBody(req){if(!req.headers.get('content-type')?.startsWith('application/json'))throw new AppError('JSON required',415);try{return v.object(JSON.parse(new TextDecoder().decode(await boundedBytes(req,1024*1024))));}catch(e){if(e instanceof AppError)throw e;throw new AppError('Invalid JSON');}}
export function cloudConfig(env){const config=JSON.parse(env.APP_CONFIG??'{}');return {...config,localMode:env.LOCAL_STANDALONE===true,betaOrigin:env.BETA_ORIGIN??config.betaOrigin,environment:env.ENVIRONMENT,origin:env.APP_ORIGIN,allowedEmail:env.ALLOWED_EMAIL,version:env.RELEASE_COMMIT,timeZone:'America/Toronto'};}
export async function handle(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!env.DB||!env.APP_ORIGIN||(!['demo','local'].includes(env.AUTH_MODE)&&(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.ALLOWED_EMAIL)))throw new AppError('Private cloud service configuration is incomplete',503);
 if(url.origin!==env.APP_ORIGIN||request.url.length>4096||path.includes('..')||path.includes('\\')||/%(?:2e|2f|5c|00)/i.test(path))throw new AppError('Not found',404);
 const store=new CloudStore(env.DB),budgetStore=env.AI_BUDGET?new CloudStore(env.AI_BUDGET):store,auth=new CloudAuth(store,env),config=cloudConfig(env);
 const notice=request.method==='GET'?publicNotice(path):null;if(notice)return new Response(notice,{headers:{'Content-Type':'text/html; charset=utf-8'}});
 if(path==='/auth/login'&&request.method==='GET')return auth.login();
 if(path==='/auth/google'&&request.method==='GET')return auth.callback(request);
 if(path.startsWith('/api/worker/'))return workerRoute({req:request,path,body:await jsonBody(request),store,env,config});
 if(path==='/api/presence')return deviceRoute({store,path,req:request,body:await jsonBody(request),config});
 // Only the deliberately published app artwork is public; all workspace assets remain authenticated.
 if(['GET','HEAD'].includes(request.method)&&/^\/icons\/(?:icon-(?:192|512)|apple-touch-icon|maskable-512|favicon)\.png$/.test(path))return env.ASSETS.fetch(request);
 const session=await auth.session(request);if(!session){if(!path.startsWith('/api/')&&request.headers.get('accept')?.includes('text/html'))return new Response(null,{status:303,headers:{Location:'/auth/login'}});throw new AppError('Authentication required',401,'unauthorized');}
 if(!['GET','HEAD'].includes(request.method)){auth.csrf(request,session);if(isRetiredProductionFixture(config,path,null))throw new AppError('Synthetic checks belong in beta.',403,'production_test_denied');}
 if(['/api/logout','/api/actions/logout'].includes(path)&&request.method==='POST')return auth.logout(request);
 if(path==='/api/cooking-help'||path.startsWith('/api/cooking-help/'))return cookingHelpRoute({req:request,path,body:request.method==='POST'?await jsonBody(request):null,store,env,session});
 if(path==='/api/session'&&request.method==='GET')return Response.json({email:session.email,csrf:session.csrf,environment:env.ENVIRONMENT,version:env.RELEASE_COMMIT,storage:'cloud'});
 if(path==='/api/quota/interactive'&&request.method==='GET')return Response.json(interactiveUsage(await budgetStore.meta('quota-telemetry')));
 if(path==='/api/quota'&&request.method==='GET'){const info=await quotaStatus(store,'support',{budgetStore});return Response.json({...info,...(env.LOCAL_MOCK_SERVICES?{decision:{allowed:true,mode:'mock',reason:'Mock services have no external provider quota. Saved reserve preferences remain editable.'}}:{}),usage:(await budgetStore.sql('SELECT category,model,started_at,ended_at,result FROM ai_usage ORDER BY started_at DESC LIMIT 30').all()).results,scope:'LifeOS admission only. Independent AI sessions share the allowance and remain outside this controller.'});}
 if(['/api/bootstrap','/api/schedule'].includes(path)&&request.method==='GET'){
  const kinds=v.readableKinds.filter(k=>!['support-message','devotional-step'].includes(k));const now=env.LOCAL_DEMO_NOW?.()??new Date().toISOString(),savedPreferences=(await store.get('settings','preferences'))?.data??{},timeZone=savedPreferences.timezone??'America/Toronto',currentDay=lifeosDay(now,timeZone),date=path==='/api/schedule'?v.date(url.searchParams.get('day')):currentDay,calendarWindow={from:addDays(date,-1),through:addDays(date,2)},plan=await loadPlan(store,kinds,{calendarWindow}),records=publicRecords(plan),prefs=plan.get('settings','preferences')?.data??savedPreferences;
  const settings=normalizeDomainSettings({...prefs,allowedCalendarIds:Object.values(config.calendarIds??{}),schoolCalendarIds:[config.calendarIds?.schoolA,config.calendarIds?.schoolB].filter(Boolean),presenceCorrections:(records['presence-correction']??[]).map(r=>({...r.data,id:r.id}))});
  const forecast=await store.meta('academic-capacity');if(forecast?.blocks)settings.academicCapacity=forecast.blocks;
  const listedJobs=await jobList(store);
  const events=(records['calendar-event']??[]).map(r=>{const c=(records['schedule-correction']??[]).find(c=>c.data.day===date&&c.data.entryId==='plan:calendar:'+r.id&&!c.data.undone)?.data;return {...r.data,id:r.id,...(c?{start:c.start??r.data.start,end:c.end??r.data.end,...(c.hidden?{status:'cancelled'}:{})}:{})};});settings.travelBlocks=await privateTravelBlocks(store,events,now,config);const today=buildToday({now:date>currentDay?zonedDateTime(date,'05:00',{timeZone}):now,date,records:{...records,presence:(records.presence??[]).filter(r=>!r.data.archived&&!r.data.undone)},events,settings,jobs:listedJobs.jobs});
  if(path==='/api/schedule')return Response.json({today});
  const tomorrow=buildToday({now:zonedDateTime(addDays(date,1),'05:00',{timeZone}),date:addDays(date,1),records,events,settings,jobs:[]});today.carouselTimeline=[...today.timeline,...tomorrow.timeline];
  const training=(records.training?.find(r=>r.id==='baseline')??records.training?.[0])?.data??{},source=records['training-source']?.[0]?.data;let trainingPlan={status:'source-needed',workouts:[],issues:['A verified training source and race date are required.']};if(source?.sourceWeeks&&training.raceDate)try{trainingPlan={...buildTrainingReference({raceDate:training.raceDate,sourceWeeks:source.sourceWeeks,program:source.program??'Beginner',raceExceptionConfirmed:training.sundayExceptionConfirmed===true,sundayRest:env.AUTH_MODE!=='demo'}),paceProfile:source.paceProfiles?.find(p=>p.goalMinutes===training.goalMinutes),source:source.source};}catch{trainingPlan={status:'source-review-needed',workouts:[],issues:['The source table needs review.']};}
  const applications=await devotionalApplications(store,date);
  records['devotional-step']=await stepCorrections(store,applications.map(r=>r.id));
  return Response.json({applications,date:currentDay,now,environment:env.ENVIRONMENT,version:env.RELEASE_COMMIT,records,calendarWindow,...listedJobs,integrations:records.integration??[],today,trainingPlan});
 }
 if(path==='/api/lecture-reviews'&&request.method==='GET')return Response.json(await dueLectureReviews(store,new URL(request.url).searchParams.get('course')));
 const lecture=await lectureRoute({store,env,config,req:request,path});if(lecture)return lecture;
 const upload=path.match(/^\/api\/uploads\/([-\w]+)\/(\d+)$/);if(upload&&request.method==='POST')return uploadChunk({store,env,config,req:request,sid:upload[1],index:Number(upload[2])});
 const file=path.match(/^\/api\/files\/([-\w]+)$/);if(file&&request.method==='GET')return downloadFile({store,env,config,id:file[1]});
 const materialFile=path.match(/^\/api\/materials\/([-\w]+)\/file$/);if(materialFile&&request.method==='GET'){const object=await store.sql('SELECT * FROM private_objects WHERE object_key=? AND verified=1','material:'+materialFile[1]).first();if(!object||object.mime_type!=='application/pdf'||object.size>50*1024*1024||![...Object.values(config.driveFolders??{}),...(config.materialReadFolders??[])].includes(object.folder_id))throw new AppError('Private material copy unavailable',404);await privateFile(env,object.drive_id,object.folder_id);return new Response((await googleFetch(env,`https://www.googleapis.com/drive/v3/files/${object.drive_id}?alt=media`)).body,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${materialFile[1]}.pdf"`,'Content-Security-Policy':"default-src 'none'; sandbox"}});}
 const body=['POST','PUT','PATCH'].includes(request.method)?await jsonBody(request):null;
 if(path==='/api/operation-world'&&request.method==='GET')return operationWorldRoute(request);
 if(path.startsWith('/api/deleted'))return deletedRoute({store,env,config,req:request,path,body});
 if(path.startsWith('/api/private-travel'))return privateTravelRoute({store,env,req:request,path,body});
 if(path.startsWith('/api/private-notes')||path.startsWith('/api/private-friends'))return (await privateNotesFriendsRoute({store,env,config,req:request,path,body}))??new Response(null,{status:404});
 if(path.startsWith('/api/private-journal/')||path.startsWith('/api/daily-photos'))return (await privateMomentsRoute({store,env,config,req:request,path,body}))??new Response(null,{status:404});
 if(['/api/prayer-answers','/api/prayer-dates','/api/devotional-step'].includes(path))return (await spiritualToolsRoute({store,req:request,path,body}))??new Response(null,{status:404});
 if(path==='/api/notifications/history'&&request.method==='GET')return Response.json(await notificationHistory(store));
 if(path==='/api/database-budget'&&request.method==='GET')return Response.json(await databaseBudgetStatus(store,env.ENVIRONMENT));
 if(path==='/api/learning-notes')return learningNotesRoute({store,req:request,path,body});
 if(path==='/api/replan')return replanningRoute({store,req:request,path,body,config});
 if(path.startsWith('/api/task-tools/')||path.startsWith('/api/task-brief/'))return (await taskToolsRoute({store,req:request,path,body}))??new Response(null,{status:404});
 if(path.startsWith('/api/revisions/'))return (await revisionRoute({store,req:request,path,body}))??new Response(null,{status:404});
 if(body&&isRetiredProductionFixture(config,path,body))throw new AppError('Synthetic checks belong in beta.',403,'production_test_denied');
 if(/^\/api\/actions\/reminder-(initialize|save|list-save|undo|staples)$/.test(path)&&request.method==='POST')return reminderRoute({store,path,body});
 if(path.startsWith('/api/finances'))return (await financeRoute({store,req:request,path,body}))??new Response(null,{status:404});
 if(path.startsWith('/api/assistant/'))return assistantRoute({store,req:request,path,body,config});
 if(path==='/api/actions/local-calendar'&&request.method==='POST'&&env.LOCAL_STANDALONE)return localCalendar({store,path,body});
 if(path==='/api/actions/schedule-entry'&&request.method==='POST')return scheduleEntryRoute({store,body,config,path});
 if(path==='/api/actions/personal-calendar'&&request.method==='POST')return Response.json(await queuePersonalCalendar({store,config,body,path}));
 if(path==='/api/actions/release'&&request.method==='POST'){
  v.exactFields(body,['action','releaseId','expectedCurrentRelease','intentional','mutationId']);v.enumValue(body.action,['promote','rollback','deploy-beta']);if((env.ENVIRONMENT!=='production'&&!env.LOCAL_STANDALONE)||body.intentional!==true)throw new AppError('Production Settings and an intentional release choice are required',403);if(!/^beta-[a-f0-9]{16}$/.test(body.releaseId??''))throw new AppError('Invalid release');const catalogue=await store.meta('release-catalogue'),target=body.action==='deploy-beta'?'beta':'production';if(!catalogue||catalogue.current?.[target]!==body.expectedCurrentRelease||!catalogue.releases?.some(r=>r.releaseId===body.releaseId))throw new AppError('Release state changed. Refresh before confirming.',409);const job={id:crypto.randomUUID(),type:'maintenance-release',payload:{action:body.action,releaseId:body.releaseId,expectedCurrentRelease:body.expectedCurrentRelease,intentional:true},component:'maintenance',priority:8,authority:'authenticated-release-action'};return Response.json(await store.commit({id:v.mutationId(body.mutationId),fingerprint:{path,body},jobs:[job],result:{job:{...job,status:'queued',progress:'Waiting for the trusted release worker'}}}));
 }
 if(path==='/api/actions/cloud-sync'&&request.method==='POST'){await scheduledTick(env);return Response.json({processed:true,scope:'one bounded cloud batch'});}
 if(path==='/api/quota/refresh'&&request.method==='POST'){await store.sql("INSERT INTO meta VALUES('quota-refresh-requested',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(Date.now())).run();return Response.json({requested:true,message:'The computer will read provider quota when connected. No model call is used.'});}
 if(path==='/api/quota/policy'&&request.method==='PUT'){
  v.exactFields(body,['mutationId','version','schoolCostPercent','safetyPercent']);v.number(body.schoolCostPercent,1,20);v.number(body.safetyPercent,5,50);v.version(body.version);
  if(env.ENVIRONMENT!=='production'&&!env.LOCAL_STANDALONE)throw new AppError('Account-wide quota policy is edited in production Settings',403);
  const old=await budgetStore.get('settings','quota-policy');if((old?.version??0)!==body.version)throw new AppError('Quota policy changed',409);const now=new Date().toISOString(),item={kind:'settings',id:'quota-policy',version:body.version+1,createdAt:old?.createdAt??now,updatedAt:now,data:{schoolCostPercent:body.schoolCostPercent,safetyPercent:body.safetyPercent}};
  return Response.json(await budgetStore.commit({id:v.mutationId(body.mutationId),fingerprint:{path,body},changes:[{kind:item.kind,id:item.id,before:old,after:item,auditId:crypto.randomUUID(),actor:'owner-quota-policy'}],result:{item}}));
 }
 const device=await deviceRoute({store,path,req:request,body,config});if(device)return device;
 const handoff=await handoffRoute({path,req:request,body,store});if(handoff)return handoff;
 if(path==='/api/actions/upload-reconcile'&&request.method==='POST')return reconcileFinalizedUpload({store,body});
 if(path==='/api/actions/upload-finalize'&&request.method==='POST')return finalizeUpload({store,config,body,path});
 const route=await recordRoute({store,req:request,path,body,config});if(route)return route;
 if(path==='/api/audit'&&request.method==='GET')return Response.json({items:(await store.sql('SELECT id,kind,record_id AS recordId,created_at AS createdAt,actor,undo_of AS undoOf FROM audit ORDER BY created_at DESC LIMIT 100').all()).results});
 if(path==='/api/health'&&request.method==='GET')return Response.json({status:'online',storage:'cloud',environment:env.ENVIRONMENT,version:env.RELEASE_COMMIT,automationPaused:!!await store.meta('automationPaused'),heartbeats:(await store.sql('SELECT name,at,last_success FROM heartbeats').all()).results});
 if(path==='/api/push/config'&&request.method==='GET')return Response.json({configured:!!config.pushPublicKey,...(config.pushPublicKey?{publicKey:config.pushPublicKey}:{})});
 if(path.startsWith('/api/local/backups/')&&request.method==='GET'&&env.LOCAL_STANDALONE){const backup=await env.LOCAL_BACKUP(v.identifier(path.split('/').at(-1)));if(!backup)throw new AppError('Backup not found',404);return Response.json(backup,{headers:{'Content-Disposition':'attachment; filename="lifeos-backup.json"'}});}
 if(path==='/api/export'&&request.method==='GET'){if(env.LOCAL_EXPORT)return Response.json(await env.LOCAL_EXPORT(),{headers:{'Content-Disposition':'attachment; filename="lifeos-backup.json"'}});const plan=await loadPlan(store,[...v.readableKinds,'devotional']);return Response.json({schemaVersion:2,exportedAt:new Date().toISOString(),environment:env.ENVIRONMENT,records:publicRecords(plan)},{headers:{'Content-Disposition':'attachment; filename="lifeos-export.json"'}});}
 if(path==='/api/releases'&&request.method==='GET'){const catalogue=await store.meta('release-catalogue')??{releases:[],current:{production:null,beta:null},deployedCommit:env.RELEASE_COMMIT};return Response.json({...catalogue,betaUrl:config.betaOrigin?httpsOrigin(config.betaOrigin):catalogue.betaUrl??null});}
 if(path.startsWith('/api/')||path.startsWith('/internal/'))throw new AppError('Not found',404);
 if(!['GET','HEAD'].includes(request.method))throw new AppError('Method not allowed',405);
 if(path==='/beta'&&env.ENVIRONMENT==='production'){if(!config.betaOrigin)throw new AppError('Set BETA_ORIGIN for the isolated beta deployment',503);return new Response(null,{status:303,headers:{Location:httpsOrigin(config.betaOrigin)}});}
 return workspaceAsset(request,env);
}
export default {async scheduled(event,env,ctx){ctx.waitUntil(scheduledTick(env));},async fetch(request,env){try{return hardened(await handle(request,env));}catch(error){if(!(error instanceof AppError))console.error(JSON.stringify({event:'lifeos-cloud-failure',name:error.name,frames:String(error.stack??'').split('\n').filter(s=>/^\s*at /.test(s)).slice(0,5)}));return hardened(Response.json({error:error instanceof AppError?error.message:'The private service is temporarily unavailable. Your device drafts are retained.',code:error instanceof AppError?error.code:'service_unavailable',...(error.current?{current:publicValue(error.current)}:{})},{status:error instanceof AppError?error.status:503}));}}};
