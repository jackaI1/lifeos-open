import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {createService} from '../local/service.ts';
type App = Awaited<ReturnType<typeof createService>>;
export type Principal = {id:string;scopes:string[]};
export class TaskJobs {
 private pending:Promise<void>|undefined;
 private stopped=false;
 private timeoutMs:number;
 private app:App;
 private execute?: (payload:any,id:string,signal:AbortSignal)=>Promise<void>;
 constructor(app:App,execute?:(payload:any,id:string,signal:AbortSignal)=>Promise<void>,timeoutMs=5000){this.app=app;this.execute=execute;this.timeoutMs=timeoutMs;}
 async init(){await this.app.db.exec("CREATE TABLE IF NOT EXISTS mcp_jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL,result TEXT,created_at BIGINT NOT NULL)");await this.app.db.prepare("UPDATE mcp_jobs SET status='queued' WHERE status='running'").run();this.kick();}
 async submit(owner:string,payload:any,key:string){const id=createHash('sha256').update(owner+':'+key).digest('hex');const count=await this.app.db.prepare("SELECT COUNT(*) AS n FROM mcp_jobs WHERE status IN ('running','queued')").first();if(Number(count?.n)>100)throw Error('Job queue full');await this.app.db.prepare("INSERT INTO mcp_jobs(id,owner,payload,status,attempts,created_at) VALUES(?,?,?,'queued',0,?) ON CONFLICT(id) DO NOTHING").bind(id,owner,JSON.stringify(payload),Date.now()).run();const job=await this.get(owner,id);if(job.payload!==JSON.stringify(payload))throw Error('Idempotency key reused with different data');this.kick();return {jobId:id,status:job.status};}
 async get(owner:string,id:string){const row=await this.app.db.prepare('SELECT * FROM mcp_jobs WHERE id=? AND owner=?').bind(id,owner).first();if(!row)throw Error('Job unavailable');return row;}
 private kick(){if(!this.stopped&&!this.pending)this.pending=new Promise<void>(r=>setImmediate(r)).then(()=>this.work()).finally(()=>{this.pending=undefined;});}
 private async work(){while(!this.stopped){const job=await this.app.db.prepare("SELECT * FROM mcp_jobs WHERE status='queued' ORDER BY created_at LIMIT 1").first();if(!job)break;
  await this.app.db.prepare("UPDATE mcp_jobs SET status='running',attempts=attempts+1 WHERE id=?").bind(job.id).run();
  try{
   if(Date.now()-Number(job.created_at)>60000)throw Error('Job timed out');
   const signal=AbortSignal.timeout(this.timeoutMs);
   if(this.execute){
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([this.execute(JSON.parse(job.payload),job.id,signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Job timed out')),this.timeoutMs);})]);}finally{clearTimeout(timer);}
   }
   else{
    const res=await this.app.fetch(new Request(this.app.origin+'/api/records/task/'+job.id,{method:'PUT',headers:{origin:this.app.origin,'content-type':'application/json','x-lifeos-csrf':this.app.env.LOCAL_CSRF,cookie:`lifeos-local=${this.app.env.LOCAL_SESSION_TOKEN}`},body:JSON.stringify({version:0,mutationId:job.id,data:{...JSON.parse(job.payload),status:'todo',difficulty:3}}),signal}));
    if(!res.ok)throw Error('Task validation or write failed');
   }
   await this.app.db.prepare("UPDATE mcp_jobs SET status='completed',result=? WHERE id=?").bind(JSON.stringify({taskId:job.id}),job.id).run();
  }catch{const retry=Number(job.attempts)<2&&Date.now()-Number(job.created_at)<60000;await this.app.db.prepare('UPDATE mcp_jobs SET status=?,result=? WHERE id=?').bind(retry?'queued':'failed',JSON.stringify({error:'Task write failed or timed out'}),job.id).run();if(retry)await new Promise(r=>setTimeout(r,50*2**Number(job.attempts)));}
 }}
 async close(){this.stopped=true;await this.pending;}
}
export function makeMcp(app:App,jobs:TaskJobs,principal:Principal){
 const server=new McpServer({name:'lifeos',version:'1.0.0'});
 const result=(data:any)=>({content:[{type:'text' as const,text:JSON.stringify(data)}]});
 let windowAt=Date.now(),requests=0;
 const need=(scope:string)=>{if(Date.now()-windowAt>60000){windowAt=Date.now();requests=0;}if(++requests>60)throw Error('Rate limit exceeded');if(!principal.scopes.includes(scope))throw Error('Token lacks '+scope);};
 const read=async(kind:string)=>{need('schedule:read');const rows=await app.db.prepare('SELECT id,data FROM records WHERE kind=? ORDER BY id LIMIT 200').bind(kind).all();return rows.results.map(r=>({id:r.id,...JSON.parse(r.data)}));};
 server.registerTool('read_schedule',{description:'Read up to 200 saved calendar events',inputSchema:{}},async()=>result(await read('calendar-event')));
 server.registerTool('read_deadlines',{description:'Read open tasks and their deadlines',inputSchema:{}},async()=>result((await read('task')).filter(t=>t.status!=='complete'&&(t.dueAt||t.dueDate))));
 server.registerTool('create_task',{description:'Queue a validated task. Poll job_status until completed. Reuse key on retry.',inputSchema:{title:z.string().trim().min(1).max(200),dueDate:z.iso.date().optional(),idempotencyKey:z.string().min(8).max(100)}},async({idempotencyKey,...task})=>{need('tasks:write');return result(await jobs.submit(principal.id,task,idempotencyKey));});
 server.registerTool('job_status',{description:'Read your asynchronous job result',inputSchema:{jobId:z.string().regex(/^[a-f0-9]{64}$/)}},async({jobId})=>{need('tasks:write');const job=await jobs.get(principal.id,jobId);return result({jobId,status:job.status,attempts:job.attempts,result:job.result?JSON.parse(job.result):null});});
 return server;
}
export function authenticate(token:string,tokens:Record<string,string[]>):Principal|undefined{
 for(const [candidate,scopes]of Object.entries(tokens)){const a=Buffer.from(token),b=Buffer.from(candidate);if(a.length===b.length&&timingSafeEqual(a,b))return {id:createHash('sha256').update(candidate).digest('hex'),scopes};}
}
export function mcpHttp(app:App,jobs:TaskJobs,tokens:Record<string,string[]>,limit=60){
 const windows=new Map<string,{at:number;n:number}>();
 return createServer(async(req,res)=>{
  const host=req.headers.host??'';
  if(!/^127\.0\.0\.1:\d+$/.test(host)||req.url!=='/mcp'||req.headers.origin&&req.headers.origin!==`http://${host}`){res.writeHead(403).end();return;}
  const principal=authenticate(String(req.headers.authorization??'').replace(/^Bearer /,''),tokens);
  if(!principal){res.writeHead(401).end();return;}
  const w=windows.get(principal.id)??{at:Date.now(),n:0};if(Date.now()-w.at>60000){w.at=Date.now();w.n=0;}windows.set(principal.id,w);
  if(++w.n>limit){res.writeHead(429,{'retry-after':'60'}).end();return;}
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true}),mcp=makeMcp(app,jobs,principal);
  try{let body='';for await(const bytes of req){body+=bytes;if(body.length>32768){res.writeHead(413).end();return;}}await mcp.connect(transport);await transport.handleRequest(req,res,body?JSON.parse(body):undefined);}
  catch{if(!res.headersSent)res.writeHead(400);res.end();}
  finally{await transport.close();await mcp.close();}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const tokens:Record<string,string[]>=JSON.parse(process.env.MCP_TOKENS??'{}');
 if(!Object.keys(tokens).length||Object.keys(tokens).some(t=>t.length<24))throw Error('Set MCP_TOKENS to scoped tokens of at least 24 characters');
 const app=await createService(),jobs=new TaskJobs(app);await jobs.init();
 let http:ReturnType<typeof mcpHttp>|undefined,mcp:McpServer|undefined;
 if(process.argv.includes('--http')){http=mcpHttp(app,jobs,tokens);http.listen(Number(process.env.MCP_PORT??8791),'127.0.0.1');}
 else{const principal=authenticate(process.env.MCP_TOKEN??'',tokens);if(!principal)throw Error('MCP_TOKEN rejected');mcp=makeMcp(app,jobs,principal);await mcp.connect(new StdioServerTransport());}
 const stop=async()=>{http?.close();http?.closeIdleConnections();await mcp?.close();await jobs.close();await app.close();};
 process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());process.stdin.once('end',()=>{if(!http)void stop();});
}
