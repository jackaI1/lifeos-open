import {operationWorldEmbed} from '../../public/operation-world.js';
import {configuredModels} from '../shared/llm.mjs';
import {mkdir,readFile,stat,realpath} from 'node:fs/promises';
import {dirname,resolve,extname,relative} from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import type {WorkspaceDatabase} from './database.ts';
import {LocalDatabase} from './database.ts';
import {LocalObjects} from './objects.ts';
import {makeWorkspace,DEMO_EMAIL} from './workspace.ts';
import {createBackup,saveVerifiedBackup} from './backup.ts';
import {drainJobs} from './services.ts';
import {createWhisperWorker} from './whisper.ts';
import cloud from '../cloud/app.mjs';
import {RecordCache} from './record-cache.ts';
import {WorkspaceRetrieval} from './retrieval-workspace.mjs';
export interface ServiceOptions {database?:string;storage?:WorkspaceDatabase;databaseUrl?:string;origin?:string;authMode?:string;demo?:boolean;env?:Record<string,string|undefined>}
export async function createService(options:ServiceOptions={}){
 const vars=options.env??process.env,origin=options.origin??vars.APP_ORIGIN??'http://127.0.0.1:8787',authMode=options.authMode??vars.AUTH_MODE??'demo';
 const address=new URL(origin);if(!['127.0.0.1','localhost','[::1]'].includes(address.hostname))throw new Error('Standalone service must bind to loopback.');
 if(!['demo','local','google'].includes(authMode))throw new Error('AUTH_MODE must be demo, local or google.');
 if(authMode==='local'&&(!vars.LOCAL_ACCESS_TOKEN||vars.LOCAL_ACCESS_TOKEN.length<24))throw new Error('Local mode requires LOCAL_ACCESS_TOKEN with at least 24 characters.');
 const databaseUrl=options.databaseUrl??vars.DATABASE_URL;
 const database=options.database??vars.LIFEOS_DATABASE??'.local/workspace.sqlite';
 if(vars.RAG_MODE&&vars.RAG_MODE!=='local')throw Error('RAG_MODE must be local or unset.');
 if(vars.RAG_THRESHOLD&&(!Number.isFinite(Number(vars.RAG_THRESHOLD))||Number(vars.RAG_THRESHOLD)<=0||Number(vars.RAG_THRESHOLD)>1))throw Error('RAG_THRESHOLD must be between 0 (exclusive) and 1.');
 const retrievalPath=vars.RAG_DATABASE??(database===':memory:'?':memory:':databaseUrl?'.local/retrieval.sqlite':database+'.retrieval.sqlite');
 if(vars.RAG_MODE==='local'&&retrievalPath!==':memory:')await mkdir(dirname(resolve(retrievalPath)),{recursive:true,mode:0o700});
 if(!options.storage&&!databaseUrl&&database!==':memory:')await mkdir(dirname(resolve(database)),{recursive:true,mode:0o700});
 const demoClock=vars.DEMO_CLOCK?Date.parse(vars.DEMO_CLOCK):null;if(demoClock!==null&&!Number.isFinite(demoClock))throw Error('DEMO_CLOCK must be an ISO date and time.');const clockStarted=Date.now();
 const db:WorkspaceDatabase=options.storage??(databaseUrl?new (await import('../storage/postgres.ts')).PostgresDatabase(databaseUrl):new LocalDatabase(database));try{await makeWorkspace(db,{now:demoClock===null?new Date():new Date(demoClock),demo:options.demo??vars.DEMO_SEED!=='false',owner:vars.ALLOWED_EMAIL??DEMO_EMAIL});}catch(error){await db.close?.();throw error;}
 const objects=new LocalObjects(db,vars.ALLOWED_EMAIL??DEMO_EMAIL),csrf=randomBytes(24).toString('hex'),sessionToken=randomBytes(32).toString('hex');
 const env:Record<string,any>={...vars,DB:db,APP_ORIGIN:origin,AUTH_MODE:authMode,LOCAL_STANDALONE:true,LOCAL_CSRF:csrf,LOCAL_SESSION_TOKEN:sessionToken,ALLOWED_EMAIL:vars.ALLOWED_EMAIL??DEMO_EMAIL,ENVIRONMENT:'beta',RELEASE_COMMIT:'0000000000000000000000000000000000000001',GOOGLE_CLIENT_ID:vars.GOOGLE_CLIENT_ID??'local-placeholder',GOOGLE_CLIENT_SECRET:vars.GOOGLE_CLIENT_SECRET??'local-placeholder',LLM_MODE:vars.LLM_MODE??'mock',LOCAL_MOCK_SERVICES:true,APP_CONFIG:JSON.stringify({calendarIds:{schoolA:'demo-school',personal:'demo-personal'},driveFolders:{uploads:'local-uploads',backups:'local-backups'},...(vars.APP_CONFIG?JSON.parse(vars.APP_CONFIG):{})}),LOCAL_OBJECTS:vars.GOOGLE_MODE==='real'?null:objects};
 const recordCache=vars.REDIS_URL?new RecordCache(vars.REDIS_URL):null;
 env.RECORD_CACHE=recordCache;
 const retrieval=vars.RAG_MODE==='local'?new WorkspaceRetrieval(retrievalPath,{threshold:vars.RAG_THRESHOLD?Number(vars.RAG_THRESHOLD):undefined,cacheDir:vars.RAG_MODEL_CACHE}):null;
 env.LOCAL_RETRIEVAL=retrieval;
 const whisper=vars.WHISPER_PYTHON&&env.LOCAL_OBJECTS?createWhisperWorker(db,{python:vars.WHISPER_PYTHON,model:vars.WHISPER_MODEL??'base.en',language:vars.WHISPER_LANGUAGE??'en'}):null;
 env.LOCAL_WHISPER=!!whisper;
 // One worker per workspace; inference runs outside the request queue.
 const kickWhisper=()=>{void whisper?.kick().catch(()=>{});};
 kickWhisper();
 if(demoClock!==null)env.LOCAL_DEMO_NOW=()=>new Date(demoClock+Date.now()-clockStarted).toISOString();
 const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.json':'application/json','.webmanifest':'application/manifest+json','.pdf':'application/pdf'};
 env.LOCAL_EXPORT=()=>createBackup(db);
 env.LOCAL_BACKUP_RUN=()=>saveVerifiedBackup(db);
 env.LOCAL_BACKUP=async(id:string)=>{const row=await db.prepare('SELECT content FROM local_snapshots WHERE id=?').bind(id).first();return row?JSON.parse(row.content):null;};
 env.ASSETS={fetch:async(req:Request)=>{const u=new URL(req.url);const name=decodeURIComponent(u.pathname)==='/'?'index.html':decodeURIComponent(u.pathname).slice(1);const root=resolve('public'),file=resolve(root,name);if(relative(root,file).startsWith('..')||name.includes('\\'))return new Response(null,{status:404});try{const canonical=await realpath(file);if(relative(root,canonical).startsWith('..')||!(await stat(canonical)).isFile())return new Response(null,{status:404});return new Response(req.method==='HEAD'?null:await readFile(canonical),{headers:{'content-type':mime[extname(file)]??'application/octet-stream'}});}catch{return new Response(null,{status:404});}}};
 // Serialize local mutations: CloudStore plans perform async reads before atomic batches.
 let serial:Promise<any>=Promise.resolve();
 const serve=async(req:Request)=>{
  const u=new URL(req.url);if(u.origin!==origin)return new Response('Origin denied',{status:403});
  if(u.pathname==='/auth/local'&&req.method==='POST'){
   if(authMode!=='local'||req.headers.get('origin')!==origin)return new Response(null,{status:403});
   const form=await req.formData(),candidate=Buffer.from(String(form.get('token')??'')),expected=Buffer.from(vars.LOCAL_ACCESS_TOKEN!);
   if(candidate.length!==expected.length||!timingSafeEqual(candidate,expected))return new Response('Access token rejected',{status:403});
   return new Response(null,{status:303,headers:{location:'/', 'set-cookie':`lifeos-local=${sessionToken}; Path=/; HttpOnly; SameSite=Strict`}});
  }
  if(u.pathname==='/api/operation-world'&&env.LOCAL_MOCK_SERVICES)return Response.json(operationWorldEmbed(u.searchParams.get('day')));
  let response=await cloud.fetch(req,env);
  if(response.ok&&!['GET','HEAD'].includes(req.method))await drainJobs(db,env);
  if(response.ok&&!['GET','HEAD'].includes(req.method))kickWhisper();
  if(response.ok&&authMode==='demo'&&env.LLM_MODE!=='real'&&req.method==='POST'&&u.pathname==='/api/cooking-help'){
   const {requestId}=await response.clone().json();
   response=await cloud.fetch(new Request(origin+'/api/cooking-help/'+encodeURIComponent(requestId),{headers:req.headers}),env);
  }
  if(u.pathname==='/api/session'&&response.ok){const session=await response.json();response=Response.json({...session,mode:authMode,services:{ai:env.LLM_MODE,files:env.LOCAL_OBJECTS?'local':'google',retrieval:retrieval?'local':'off'},fictional:options.demo??vars.DEMO_SEED!=='false',ai:{models:configuredModels(env),usage:false},externalOrigins:env.GOOGLE_MODE==='real'?[...String(vars.EXTERNAL_LINK_ORIGINS??'').split(',')].filter(Boolean).map(value=>new URL(value!).origin):[]});}
  // Local-only service capabilities used by feature UIs; no external workers are launched.
  return response;
 };
 return {origin,db,env,async fetch(req:Request){const result=serial.then(()=>serve(req));serial=result.catch(()=>{});return result;},async close(){await serial;await whisper?.close();await retrieval?.close();recordCache?.close();await db.close?.();}};
}
