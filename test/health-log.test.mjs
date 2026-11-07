import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {healthLog} from '../src/hosted/log.mjs';
import {createDemoServer} from '../src/hosted/server.mjs';

test('health logs are structured and failed checks are alarmable',()=>{
 assert.deepEqual(healthLog(503,new Date('2026-11-06T00:00:00Z')),{timestamp:'2026-11-06T00:00:00.000Z',service:'lifeos-public-demo',event:'health_check',status:503,ok:false});
 assert.ok(healthLog(200).ok);
});

test('public health endpoint reflects missing and present demo shell',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'lifeos-health-')),server=createDemoServer({directory:dir});
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port=server.address().port,url=`http://127.0.0.1:${port}/healthz`;
  t.diagnostic(`owner=public-health-test pid=${process.pid} start=${new Date(Date.now()-process.uptime()*1000).toISOString()} port=${port} cleanup=server.close() in finally`);
  assert.equal((await fetch(url)).status,503);
  await writeFile(join(dir,'index.html'),'<html>Fictional demo</html>');
  assert.equal((await fetch(url)).status,200);
 }finally{
  if(server.listening){const closed=new Promise(r=>server.close(r));server.closeAllConnections();await closed;}
  await rm(dir,{recursive:true,force:true});
 }
});

test('standalone entry emits structured health events and exits cleanly',{timeout:12000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'lifeos-health-workspace-')),probe=createServer();
 let child,exited,origin,output='';
 try{
  await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  origin=`http://127.0.0.1:${port}`;
  const env=Object.fromEntries(['PATH','HOME','TMPDIR','SYSTEMROOT'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
  Object.assign(env,{PORT:String(port),APP_ORIGIN:origin,LIFEOS_DATABASE:join(dir,'workspace.sqlite'),AUTH_MODE:'demo',DEMO_SEED:'true',GOOGLE_MODE:'local',LLM_MODE:'mock'});
  child=spawn(process.execPath,['src/local/main.ts'],{env,stdio:['ignore','pipe','pipe']});exited=once(child,'exit');
  for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{output=(output+bytes).slice(-8192);});
  const start=execFileSync('ps',['-p',String(child.pid),'-o','lstart='],{encoding:'utf8'}).trim();
  t.diagnostic(`owner=standalone-health-test pid=${child.pid} start=${start} port=${port} cleanup=owned child SIGTERM and wait in finally`);
  await eventually(async()=>{if(child.exitCode!==null||child.signalCode!==null)throw Error('Fixture exited before health readiness');return(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(200)}).catch(()=>null))?.ok;});
  await eventually(()=>output.split('\n').some(line=>{try{const log=JSON.parse(line);return log.service==='lifeos-workspace'&&log.event==='health_check'&&log.status===200&&log.ok===true&&Number.isFinite(Date.parse(log.timestamp));}catch{return false;}}));
 }finally{
  try{
  if(probe.listening)await new Promise(r=>probe.close(r));
  if(child){
   let deadline;
   try{
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await Promise.race([exited,new Promise(r=>{deadline=setTimeout(r,4000);})]);}
   }finally{clearTimeout(deadline);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
   assert.ok(child.exitCode!==null||child.signalCode!==null,'owned process must exit');
   assert.notEqual(child.signalCode,'SIGKILL','fixture must shut down gracefully');
   await assert.rejects(fetch(origin+'/api/health',{signal:AbortSignal.timeout(300)}));
  }
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
async function eventually(check){const end=Date.now()+4000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Health fixture did not become ready');}
