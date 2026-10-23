import {DurableObject} from 'cloudflare:workers';
import cloud from '../cloud/app.mjs';
import {equal} from '../cloud/auth.mjs';
import {HostedDatabase} from './database.ts';
import {LocalObjects} from '../local/objects.ts';
import {makeWorkspace,DEMO_EMAIL} from '../local/workspace.ts';
import {createBackup} from '../local/backup-data.ts';
import {drainJobs} from '../local/services.ts';
import {readFixture} from './fixture-assets.ts';
import {IDLE_MS,randomVisitor,signVisitor,parseVisitorCookie,visitorCookie} from './visitor.ts';
import {validateDemoBindings,allowDemoRequest,boundRequest,demoHeaders,DEMO_JOBS} from './policy.ts';
export {DemoAdmission} from './admission.ts';
const error=(message:string,status=403)=>Response.json({error:message,code:'demo_boundary'},{status});
export class DemoWorkspace extends DurableObject {
 serial=Promise.resolve();
 fetch(req:Request):Promise<Response>{const pending=this.serial.then(()=>this.serve(req));this.serial=pending.then(()=>{},()=>{});return pending;}
 readState(){this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS _demo_state(id INTEGER PRIMARY KEY,state TEXT NOT NULL)');const row=this.ctx.storage.sql.exec('SELECT state FROM _demo_state WHERE id=1').toArray()[0];return row?JSON.parse(row.state):null;}
 writeState(state:any){this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS _demo_state(id INTEGER PRIMARY KEY,state TEXT NOT NULL)');this.ctx.storage.sql.exec('INSERT INTO _demo_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state',JSON.stringify(state));}
 async serve(req:Request){
  const env=this.env as any,u=new URL(req.url),now=Date.now();
  let state:any=this.readState();
  if(state&&(state.expired||state.expiresAt<=now)){await this.ctx.storage.deleteAll();this.writeState({expired:true});return error('This temporary demo has expired. Reload to start a fresh demo.',410);}
  const db=new HostedDatabase(this.ctx.storage);
  if(!state||state.needsSeed){await makeWorkspace(db,{readAsset:readFixture as any});state=state??{csrf:randomVisitor(),expiresAt:now+IDLE_MS,minute:0,count:0};delete state.needsSeed;}
  const minute=Math.floor(now/60000);if(state.minute!==minute){state.minute=minute;state.count=0;}if(state.count>=60)return error('Demo request limit reached. Please wait a minute.',429);state.count++;state.expiresAt=now+IDLE_MS;this.writeState(state);await this.ctx.storage.setAlarm(state.expiresAt);
  const local:any={DB:db,APP_ORIGIN:env.DEMO_ORIGIN,AUTH_MODE:'demo',LOCAL_STANDALONE:true,LOCAL_CSRF:state.csrf,ALLOWED_EMAIL:DEMO_EMAIL,ENVIRONMENT:'beta',RELEASE_COMMIT:'0000000000000000000000000000000000000001',GOOGLE_CLIENT_ID:'fictional',GOOGLE_CLIENT_SECRET:'fictional',LLM_MODE:'mock',LOCAL_MOCK_SERVICES:true,LOCAL_OBJECTS:new LocalObjects(db,DEMO_EMAIL),ASSETS:env.ASSETS,APP_CONFIG:JSON.stringify({calendarIds:{schoolA:'demo-school',personal:'demo-personal'},driveFolders:{uploads:'local-uploads',devotional:'local-devotional',prayer:'local-prayer',backups:'local-backups'}})};
  if(req.headers.has('x-lifeos-demo-generation')&&!equal(req.headers.get('x-lifeos-demo-generation'),state.csrf))return error('This demo was reset or expired. Reload to start fresh.',409);
  if(!['GET','HEAD'].includes(req.method)&&(req.headers.get('origin')!==env.DEMO_ORIGIN||!equal(req.headers.get('x-lifeos-csrf'),state.csrf)))return error('Demo request verification failed');
  if(u.pathname==='/api/demo/status')return Response.json({fictional:true,expiresAt:state.expiresAt,limits:{storage:20*1024*1024,request:1048576}});
  if(u.pathname==='/api/demo/reset'&&req.method==='POST'){await this.ctx.storage.deleteAll();this.writeState({...state,csrf:randomVisitor(),needsSeed:true});return Response.json({reset:true});}
  if(u.pathname==='/api/export')return Response.json(await createBackup(db),{headers:{'content-disposition':'attachment; filename="lifeos-demo-export.json"'}});
  if(u.pathname==='/api/operation-world')return Response.json({day:u.searchParams.get('day'),items:[{title:'Community reflection',text:'Fictional example: remember people who need kindness, shelter and peace.'}],mock:true,source:null});
  let response=await cloud.fetch(req,local);
  if(response.ok&&!['GET','HEAD'].includes(req.method))await drainJobs(db,local);
  if(u.pathname==='/api/session'&&response.ok){const session=await response.json();response=Response.json({...session,mode:'demo',fictional:true,services:{ai:'mock',files:'local'},externalOrigins:[],ai:{models:[{id:'demo-ai',label:'Demo AI (offline)'}],usage:false}});}
  if(u.pathname==='/'&&response.ok&&req.method==='GET'){const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');response=new Response(html.replace(/\/app\.js"/,'/demo-bootstrap.js"'),{headers});}
  return response;
 }
 async alarm(){const state:any=this.readState();if(state&&state.expiresAt<=Date.now()){await this.ctx.storage.deleteAll();this.writeState({expired:true});}else if(state?.expiresAt)await this.ctx.storage.setAlarm(state.expiresAt);}
}
export default {
 async fetch(original:Request,env:any){
  try{
   validateDemoBindings(env);const u=new URL(original.url);if(u.origin!==env.DEMO_ORIGIN)return error('Unknown demo origin',404);
   const api=u.pathname.startsWith('/api/');
   if(api&&!allowDemoRequest(original.method,u.pathname))return demoHeaders(error('This action is available only in a personal installation.'),env.PARENT_ORIGIN);
   const staticFile=/^\/(?:__assets\/[a-f0-9]{40}\/)?[A-Za-z0-9_./-]+\.(?:js|mjs|css|png|jpg|svg|woff2?|ttf|json|webmanifest|pdf|wav)$/.test(u.pathname)&&!u.pathname.includes('..');
   if(!api&&u.pathname!=='/'&&!staticFile)return demoHeaders(error('Demo page not found',404),env.PARENT_ORIGIN);
   if(staticFile){if(!['GET','HEAD'].includes(original.method))return error('Method not allowed',405);const url=new URL(original.url);url.pathname=url.pathname.replace(/^\/__assets\/[a-f0-9]{40}/,'');return demoHeaders(await env.ASSETS.fetch(new Request(url,{method:original.method})),env.PARENT_ORIGIN);}
   if(u.pathname==='/'&&!['GET','HEAD'].includes(original.method))return error('Method not allowed',405);
   const previous=await parseVisitorCookie(original,env.SESSION_SECRET);
   if(api&&!previous)return demoHeaders(error('Open the demo to start a visitor session.',401),env.PARENT_ORIGIN);
   if(!await env.ADMISSION.get(env.ADMISSION.idFromName('daily')).check(!previous))return demoHeaders(error('The free demo is at capacity. Please try again later.',429),env.PARENT_ORIGIN);
   let id=previous?.id??randomVisitor();const request=await boundRequest(original);
   if(u.pathname==='/api/jobs'&&request.method==='POST'){let job;try{job=await request.clone().json();}catch{return error('JSON is required',400);}if(!DEMO_JOBS.has(job.type))return demoHeaders(error('That service is unavailable in this fictional demo.'),env.PARENT_ORIGIN);}
   let response=await env.WORKSPACES.get(env.WORKSPACES.idFromName(id)).fetch(request);
   if(u.pathname==='/'&&previous&&response.status===410){
    await response.body?.cancel();if(!await env.ADMISSION.get(env.ADMISSION.idFromName('daily')).check(true))return demoHeaders(error('The free demo is at capacity. Please try again later.',429),env.PARENT_ORIGIN);
    id=randomVisitor();response=await env.WORKSPACES.get(env.WORKSPACES.idFromName(id)).fetch(request);
   }
   const headers=new Headers(response.headers);if(response.status<400)headers.set('set-cookie',visitorCookie(await signVisitor(id,env.SESSION_SECRET)));
   return demoHeaders(new Response(response.body,{status:response.status,headers}),env.PARENT_ORIGIN);
  }catch(e){return error(e instanceof Error&&e.message.includes('size limit')?'Demo request size limit reached':'The demo is temporarily unavailable.',e instanceof Error&&e.message.includes('size limit')?413:503);}
 }
};
