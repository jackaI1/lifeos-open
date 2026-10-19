import {chromium} from 'playwright';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const scratch=resolve(process.env.PARITY_DIR??'.runtime/e2e'),run=process.env.E2E_RUN??'latest';await mkdir(join(scratch,'evidence'),{recursive:true});await mkdir(join(scratch,'phone'),{recursive:true});
const owned=[],results=[];let browser,server,context,page;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function start(name,extra={}){
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));assert.ok(![8650,8611,8612,8613,8614,8655,8661,86214].includes(port));
 const origin=`http://127.0.0.1:${port}`,database=join(scratch,'databases',run,name+'.sqlite');await mkdir(join(scratch,'databases',run),{recursive:true});await rm(database,{force:true});
 const env={...process.env,PORT:String(port),APP_ORIGIN:origin,LIFEOS_DATABASE:database,AUTH_MODE:'demo',DEMO_SEED:'true',LLM_MODE:'mock',GOOGLE_MODE:'local',DEMO_CLOCK:'2026-10-19T10:35:00Z',...extra};
 // Direct entry avoids loading any .env or contacting a real integration.
 const child=spawn(process.execPath,['src/local/main.ts'],{env,stdio:['ignore','pipe','pipe']});let output='';for(const s of [child.stdout,child.stderr])s.on('data',b=>output=(output+b).slice(-2000));
 const entry={owner:'lifeos-open parity '+name,pid:child.pid,start:execFileSync('ps',['-p',String(child.pid),'-o','lstart='],{encoding:'utf8',env:{...process.env,TZ:'UTC'}}).trim(),port,startTimeZone:'UTC',cleanup:`kill -TERM ${child.pid}`,closed:false};owned.push(entry);await writeFile(join(scratch,'ownership-'+run+'.json'),JSON.stringify(owned,null,2));
 for(let i=0;i<100;i++){if(child.exitCode!==null||child.signalCode!==null){await stop({child,entry,origin});throw Error(output);}try{if((await fetch(origin+'/api/health')).ok)return {child,entry,origin};}catch{}await sleep(50);}await stop({child,entry,origin});throw Error('Server did not start: '+output);
}
async function stop(s){if(!s)return;const running=()=>s.child.exitCode===null&&s.child.signalCode===null;if(running()){s.child.kill('SIGTERM');await Promise.race([once(s.child,'exit'),sleep(4000)]);if(running()){s.child.kill('SIGKILL');await once(s.child,'exit');}}s.entry.closed=s.child.exitCode!==null||s.child.signalCode!==null;try{await fetch(s.origin+'/api/health',{signal:AbortSignal.timeout(500)});s.entry.portClosed=false;}catch{s.entry.portClosed=true;}}
async function configured(scope,question,needles){
 const requests=[];const stub=createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;requests.push(JSON.parse(body));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'Synthetic stub response: context received.'}}]}));});await new Promise(r=>stub.listen(0,'127.0.0.1',r));const port=stub.address().port;const stubEntry={owner:'parity local AI stub',pid:process.pid,start:execFileSync('ps',['-p',String(process.pid),'-o','lstart='],{encoding:'utf8',env:{...process.env,TZ:'UTC'}}).trim(),port,cleanup:'runner finally closes stub handle',closed:false};owned.push(stubEntry);let s,c;
 try{s=await start('configured-'+scope,{LLM_MODE:'real',LLM_BASE_URL:`http://127.0.0.1:${port}/v1`,LLM_API_KEY:'synthetic-test-key',LLM_MODEL:'synthetic-model'});c=await browser.newContext({viewport:{width:1440,height:900}});const p=await c.newPage();p.origin=s.origin;const {go,lecture,button,ask,visible}=await import('../test/e2e/helpers.mjs');if(scope==='lecture'){await lecture(p);await button(p,'Lecture Tutor').click();}else await go(p,'school?assistant=new');await ask(p,question);await visible(p,'Synthetic stub response');assert.ok(requests.length,'No outgoing compatible request');const text=JSON.stringify(requests);for(const n of needles)assert.ok(text.includes(n),'Provider request missing context: '+n);await writeFile(join(scratch,scope+'-stub-context.json'),JSON.stringify(requests,null,2));}finally{if(c)await c.close();await stop(s);await new Promise(r=>stub.close(r));stubEntry.closed=true;stubEntry.portClosed=true;}
}
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 owned.push({owner:'parity isolated Chromium',pid:process.pid,start:execFileSync('ps',['-p',String(process.pid),'-o','lstart='],{encoding:'utf8',env:{...process.env,TZ:'UTC'}}).trim(),children:execFileSync('ps',['-axo','pid=,ppid=,lstart=,comm='],{encoding:'utf8',env:{...process.env,TZ:'UTC'}}).split('\n').filter(l=>Number(l.trim().split(/\s+/)[1])===process.pid),cleanup:'await browser.close() in finally',port:null});
 const specs=(await readdir('test/e2e')).filter(f=>f.endsWith('.spec.mjs')&&(!process.env.E2E_FOCUS||new RegExp(process.env.E2E_FOCUS).test(f))).sort();
 for(const phone of process.env.E2E_DESKTOP_ONLY?[false]:process.env.E2E_PHONE_ONLY?[true]:[false,true])for(const file of specs){
  const errors=[],blockedExternal=[];let result={spec:file,viewport:phone?'390x844':'1440x900',status:'FAIL'};
  try{
   server=await start(file.slice(0,2)+(phone?'-phone':'-desktop'));
   context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1440,height:900},hasTouch:phone,isMobile:phone,timezoneId:process.env.TZ??'America/Toronto'});await context.grantPermissions(['microphone'],{origin:server.origin});
   await context.route('**/*',async route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname)&&url.protocol.startsWith('http')){(process.env.E2E_AUDIT_CONTROLS?blockedExternal:errors).push('External request blocked: '+url.origin+url.pathname);await route.abort();}else await route.continue();});
   page=await context.newPage();page.origin=server.origin;page.setDefaultTimeout(4000);page.setDefaultNavigationTimeout(15000);
   page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});page.on('pageerror',e=>errors.push('page: '+e.message));page.on('response',r=>{if(r.url().startsWith(server.origin)&&r.status()>=400)errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);});page.on('requestfailed',r=>{if(r.url().startsWith(server.origin))errors.push('request: '+new URL(r.url()).pathname+' '+r.failure()?.errorText);});
   const spec=await import('../test/e2e/'+file);let deadline;try{await Promise.race([spec.default({page,configured}),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Spec exceeded its bounded execution deadline')),process.env.E2E_AUDIT_CONTROLS?240000:90000);})]);}finally{clearTimeout(deadline);}await page.waitForLoadState('networkidle');assert.deepEqual(errors,[],'Browser diagnostics');const fit=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(fit.scroll<=fit.width+2,'Horizontal overflow '+JSON.stringify(fit));result.status='PASS';
  }catch(e){result.error=e.stack?.slice(0,2200)??String(e);if(page&&!page.isClosed())result.visible=(await page.locator('#main').innerText().catch(()=>'' )).slice(-3000);}
  finally{
   result.errors=errors;result.blockedExternal=blockedExternal;result.resource=server?.entry;const slug=file.replace('.spec.mjs','.png');if(page&&!page.isClosed()){await page.screenshot({path:join(scratch,phone?'phone':'evidence',slug),fullPage:false,animations:'disabled'}).catch(e=>result.screenshotError=e.message);await page.close({runBeforeUnload:false});}if(context)await context.close();await stop(server);context=page=server=null;results.push(result);await writeFile(join(scratch,`results-${run}.json`),JSON.stringify(results,null,2));console.log(`${result.status} ${result.viewport} ${file}${result.error?' '+result.error.split('\n')[0]:''}`);
  }
 }
}finally{
 if(context)await context.close();await stop(server);if(browser)await browser.close();await writeFile(join(scratch,'ownership-'+run+'.json'),JSON.stringify(owned,null,2));await writeFile(join(scratch,'cleanup-'+run+'.json'),JSON.stringify({browserClosed:!browser?.isConnected(),allServersClosed:owned.filter(o=>o.port).every(o=>o.closed&&o.portClosed)},null,2));
}
console.log(`${results.filter(r=>r.status==='PASS').length}/${results.length} passed.`);if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
