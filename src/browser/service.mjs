import {operationWorldEmbed} from '../../public/operation-world.js';
import cloud from '../cloud/app.mjs';
import {makeWorkspace,DEMO_EMAIL} from '../local/workspace.ts';
import {LocalObjects} from '../local/objects.ts';
import {drainJobs} from '../local/services.ts';
import {createBackup} from '../local/backup-data.ts';
import {configuredModels} from '../shared/llm.mjs';
import {BrowserDatabase} from './database.mjs';
import schema from '../cloud/schema.sql';
export async function createBrowserService({SQL,origin,bytes,readAsset,now=new Date()}){
 const db=new BrowserDatabase(SQL,bytes),csrf='browser-local-workspace';
 await makeWorkspace(db,{now,owner:DEMO_EMAIL,readAsset:(name,encoding)=>name==='src/cloud/schema.sql'?Promise.resolve(schema):readAsset(name,encoding)});
 const env={DB:db,APP_ORIGIN:origin,AUTH_MODE:'demo',LOCAL_STANDALONE:true,LOCAL_CSRF:csrf,ALLOWED_EMAIL:DEMO_EMAIL,ENVIRONMENT:'beta',RELEASE_COMMIT:'browser-local-v1',LLM_MODE:'mock',LOCAL_MOCK_SERVICES:true,APP_CONFIG:JSON.stringify({calendarIds:{schoolA:'demo-school',personal:'demo-personal'},driveFolders:{uploads:'local-uploads',devotional:'local-devotional',prayer:'local-prayer',backups:'local-backups'}}),LOCAL_OBJECTS:new LocalObjects(db,DEMO_EMAIL),ASSETS:{fetch:()=>new Response(null,{status:404})}};
 env.LOCAL_EXPORT=()=>createBackup(db);
 env.LOCAL_BACKUP_RUN=async()=>{db.exec('CREATE TABLE IF NOT EXISTS local_snapshots(id TEXT PRIMARY KEY,content TEXT NOT NULL)');const content=await createBackup(db),id=crypto.randomUUID();await db.prepare('INSERT INTO local_snapshots VALUES(?,?)').bind(id,JSON.stringify(content)).run();return {id};};
 env.LOCAL_BACKUP=async(id)=>{const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='local_snapshots'").first();if(!exists)return null;const row=await db.prepare('SELECT content FROM local_snapshots WHERE id=?').bind(id).first();return row?JSON.parse(row.content):null;};
 return {db,csrf,close:()=>db.close(),async fetch(request){
  const url=new URL(request.url);if(url.origin!==origin)return Response.json({error:'Browser workspace origin denied'},{status:403});
  // Return only the public widget descriptor; the isolated frame fetches its own feed.
  if(url.pathname==='/api/operation-world')return Response.json(operationWorldEmbed(url.searchParams.get('day')));
  if(url.pathname==='/auth/google'||url.pathname.startsWith('/api/worker/'))return Response.json({error:'This workspace stays in this browser.'},{status:403});
  let response=await cloud.fetch(request,env);
  if(response.ok&&!['GET','HEAD'].includes(request.method))await drainJobs(db,env);
  // This offline job has already settled. Return its exact retained receipt so
  // a preset click does not require a second manual status check.
  if(response.ok&&request.method==='POST'&&url.pathname==='/api/cooking-help'){
   const {requestId}=await response.clone().json();
   response=await cloud.fetch(new Request(origin+'/api/cooking-help/'+encodeURIComponent(requestId),{headers:request.headers}),env);
  }
  if(url.pathname==='/api/session'&&response.ok)response=Response.json({...await response.json(),storage:'browser',mode:'demo',services:{ai:'mock',files:'local'},browserOnly:true,fictional:true,ai:{models:configuredModels(env),usage:false},externalOrigins:[]});
  if(url.pathname==='/api/health'&&response.ok)response=Response.json({...await response.json(),storage:'browser'});
  return response;
 }};
}
