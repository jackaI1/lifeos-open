import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{Client}from'@modelcontextprotocol/sdk/client/index.js';import{StreamableHTTPClientTransport}from'@modelcontextprotocol/sdk/client/streamableHttp.js';import{StdioClientTransport}from'@modelcontextprotocol/sdk/client/stdio.js';
import{createService}from'../src/local/service.ts';import{TaskJobs,mcpHttp}from'../src/mcp/server.ts';
const token='fictional-test-token-123456789',parse=r=>JSON.parse(r.content[0].text);
test('official MCP HTTP client reads schedule, writes real task, polls and deduplicates',async t=>{
 const app=await createService({database:':memory:'}),jobs=new TaskJobs(app);await jobs.init();const server=mcpHttp(app,jobs,{[token]:['schedule:read','tasks:write'],'readonly-token-12345678901234':['schedule:read']});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=new URL(`http://127.0.0.1:${server.address().port}/mcp`),client=new Client({name:'test',version:'1'});
 t.after(async()=>{await client.close();await new Promise(r=>server.close(r));await jobs.close();await app.close();});
 assert.equal((await fetch(url,{method:'POST'})).status,401);
 await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{authorization:'Bearer '+token}}}));assert.equal((await client.listTools()).tools.length,4);
 assert.ok(parse(await client.callTool({name:'read_schedule',arguments:{}})).length>0);
 const args={title:'Fictional MCP task',dueDate:'2026-11-10',idempotencyKey:'same-write'};
 const job=parse(await client.callTool({name:'create_task',arguments:args}));let status;
 for(let n=0;n<30;n++){status=parse(await client.callTool({name:'job_status',arguments:{jobId:job.jobId}}));if(['completed','failed'].includes(status.status))break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(status.status,'completed',JSON.stringify(status));assert.equal(parse(await client.callTool({name:'create_task',arguments:args})).jobId,job.jobId);
 const task=await app.db.prepare("SELECT data FROM records WHERE kind='task' AND id=?").bind(job.jobId).first();assert.equal(JSON.parse(task.data).title,args.title);
 assert.ok((await client.callTool({name:'create_task',arguments:{...args,title:''}})).isError);
 const reader=new Client({name:'read',version:'1'});try{await reader.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{authorization:'Bearer readonly-token-12345678901234'}}}));assert.ok((await reader.callTool({name:'create_task',arguments:args})).isError);}finally{await reader.close();}
});
test('jobs retry bounded failures and fail closed; HTTP limits authenticated requests',async t=>{
 const app=await createService({database:':memory:'});let attempts=0;const jobs=new TaskJobs(app,async()=>{attempts++;throw Error('failed');});await jobs.init();const job=await jobs.submit('a',{title:'a'},'retry-key');
 t.after(async()=>{await jobs.close();await app.close();});let row;for(let n=0;n<40;n++){row=await jobs.get('a',job.jobId);if(row.status==='failed')break;await new Promise(r=>setTimeout(r,20));}assert.equal(row.status,'failed');assert.equal(attempts,3);await assert.rejects(jobs.get('other',job.jobId));
 const s=mcpHttp(app,jobs,{[token]:['schedule:read']},1);await new Promise(r=>s.listen(0,'127.0.0.1',r));try{const url=`http://127.0.0.1:${s.address().port}/mcp`;await fetch(url,{headers:{authorization:'Bearer '+token}});assert.equal((await fetch(url,{headers:{authorization:'Bearer '+token}})).status,429);}finally{await new Promise(r=>s.close(r));}
});
test('official stdio client starts server and calls schedule tool',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lifeos-mcp-')),client=new Client({name:'stdio-test',version:'1'});
 try{await client.connect(new StdioClientTransport({command:process.execPath,args:['src/mcp/server.ts'],env:{...process.env,LIFEOS_DATABASE:join(dir,'workspace.sqlite'),MCP_TOKEN:token,MCP_TOKENS:JSON.stringify({[token]:['schedule:read']})},stderr:'ignore'}));assert.ok(parse(await client.callTool({name:'read_deadlines',arguments:{}})).length>0);}
 finally{await client.close();await rm(dir,{recursive:true,force:true});}
});
test('unresponsive asynchronous action times out after bounded retries',async()=>{
 const app=await createService({database:':memory:'}),jobs=new TaskJobs(app,async()=>new Promise(()=>{}),5);await jobs.init();
 try{const submitted=await jobs.submit('timeout',{title:'Never completes'},'timeout-id');let row;for(let n=0;n<40;n++){row=await jobs.get('timeout',submitted.jobId);if(row.status==='failed')break;await new Promise(r=>setTimeout(r,10));}assert.equal(row.status,'failed');assert.equal(row.attempts,3);}finally{await jobs.close();await app.close();}
});
