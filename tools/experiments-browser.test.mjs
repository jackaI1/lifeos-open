import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {resolve, extname} from 'node:path';
import {chromium} from 'playwright';
import {bucket, STATE_KEY} from '../src/analytics/experiments/controller.ts';
import {CONSENT_KEY} from '../src/analytics/datalayer.ts';

// Real browser-only SQLite workspace and real Academics task form. No Google
// identifiers, network telemetry, credentials, owner tabs or private records.
test('real demo saves tasks in both variants; consent, reload, flag and export boundaries', {timeout:120000}, async()=>{
 const directory=resolve('.runtime/experiments');await mkdir(directory,{recursive:true});
 const owned=[];let browserServer,browser,http;
 const mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.sql':'text/plain','.json':'application/json','.svg':'image/svg+xml'};
 try{
  http=createServer(async(req,res)=>{
   try{
    const pathname=new URL(req.url,'http://fixture.test').pathname;
    const file=resolve('public','.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(resolve('public')+'/')){res.writeHead(403).end();return;}
    let body=await readFile(file);
    if(pathname==='/'||pathname==='/index.html')body=Buffer.from(body.toString().replace('src="/app.js"','src="/demo-bootstrap.js"'));
    res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream'});res.end(body);
   }catch{res.writeHead(404).end();}
  });
  await new Promise(r=>http.listen(0,'127.0.0.1',r));const port=http.address().port,origin=`http://127.0.0.1:${port}`;
  owned.push({owner:'task experiment static fixture',pid:process.pid,start:execFileSync('ps',['-p',String(process.pid),'-o','lstart='],{encoding:'utf8'}).trim(),port,cleanup:'http.close() in finally'});
  browserServer=await chromium.launchServer({headless:true,host:'127.0.0.1'});
  owned.push({owner:'task experiment isolated Chromium',pid:browserServer.process().pid,start:execFileSync('ps',['-p',String(browserServer.process().pid),'-o','lstart='],{encoding:'utf8'}).trim(),port:Number(new URL(browserServer.wsEndpoint()).port),cleanup:'browser.close(); browserServer.close() in finally'});
  await writeFile(resolve(directory,'ownership.json'),JSON.stringify(owned,null,2));
  browser=await chromium.connect(browserServer.wsEndpoint());
  const ids={};for(let i=0;Object.keys(ids).length<2;i++){const id=`fictional-browser-${i}`;ids[await bucket(id)]=id;}
  for(const mode of ['control','treatment','off','gpc','fresh']){
   const context=await browser.newContext({viewport:mode==='treatment'?{width:390,height:844}:{width:1440,height:900},acceptDownloads:true});let page;
   const errors=[],external=[];
   try{
    // Real storage references are captured before the demo scopes workspace keys.
    await context.addInitScript(({id,mode,key,consentKey})=>{
     window.fixtureStorage=localStorage;
     if(!sessionStorage.getItem('fixture-initialized')){
      sessionStorage.setItem('fixture-initialized','yes');
      if(mode!=='fresh'&&!localStorage.getItem(consentKey))localStorage.setItem(consentKey,'granted');
      if(id&&!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({id}));
     }
     if(mode==='gpc')Object.defineProperty(navigator,'globalPrivacyControl',{value:true});
     if(mode==='off')document.addEventListener('DOMContentLoaded',()=>{const meta=document.createElement('meta');meta.name='lifeos-experiment-task-entry';meta.content='off';document.head.append(meta);},{once:true});
    },{id:ids[mode]??ids.treatment,mode,key:STATE_KEY,consentKey:CONSENT_KEY});
    await context.route('**/*',route=>{
     if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}
     return route.continue();
    });
    page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/#school');
    const task=page.locator('[data-task-entry-experiment]');await task.waitFor();
    if(mode==='fresh'){
     assert.equal(await task.textContent(),'New task');
     assert.equal(await page.evaluate(key=>fixtureStorage.getItem(key),STATE_KEY),null);
     await page.getByRole('button',{name:'Allow analytics',exact:true}).click();
     await page.waitForFunction(key=>JSON.parse(fixtureStorage.getItem(key)||'{}').exposure!==undefined,STATE_KEY);
    }else if(mode==='gpc'||mode==='off'){
     assert.equal(await task.textContent(),'New task');
     assert.equal(await page.evaluate(key=>fixtureStorage.getItem(key),STATE_KEY),null);
     continue;
    }else{
     await page.waitForFunction(({key,label})=>JSON.parse(fixtureStorage.getItem(key)||'{}').exposure!==undefined&&document.querySelector('[data-task-entry-experiment]').textContent===label,{key:STATE_KEY,label:mode==='treatment'?'Plan a task':'New task'});
    }
    const label=await task.textContent();
    await task.click();await page.getByRole('textbox',{name:'Task title',exact:true}).fill('Fictional experiment task');
    await page.getByRole('button',{name:'Save task',exact:true}).click();
    await page.waitForFunction(key=>JSON.parse(fixtureStorage.getItem(key)||'{}').outcome!==undefined,STATE_KEY);
    await page.locator('#dialog').waitFor({state:'hidden'});
    // Verify real database persistence, not just an event emitted by a fixture.
    assert.ok(await page.evaluate(async()=>{const b=await(await fetch('/api/bootstrap')).json();return b.records.task.some(t=>t.data.title==='Fictional experiment task');}));
    const before=await page.evaluate(key=>fixtureStorage.getItem(key),STATE_KEY);
    await page.reload();await task.waitFor();assert.equal(await task.textContent(),label);
    assert.equal(await page.evaluate(key=>fixtureStorage.getItem(key),STATE_KEY),before);
    await page.getByRole('button',{name:'Task label experiment',exact:true}).click();
    await page.getByRole('dialog',{name:'Task label experiment report'}).waitFor();
    assert.match(await page.getByRole('dialog',{name:'Task label experiment report'}).innerText(),/not enough data/);
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download this browser’s counts'}).click()]);
    const exportPath=resolve(directory,mode+'-counts.json');await download.saveAs(exportPath);
    const exported=JSON.parse(await readFile(exportPath,'utf8'));
    assert.equal(exported.control.exposures+exported.treatment.exposures,1);assert.equal(exported.control.conversions+exported.treatment.conversions,1);
    assert.equal(JSON.stringify(exported).includes('Fictional experiment task'),false);assert.equal(JSON.stringify(exported).includes('fictional-browser'),false);
    await page.screenshot({path:resolve(directory,mode+'.png')});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('button',{name:'Close report'}).click();
    let sibling;
    if(mode==='control'){
     sibling=await context.newPage();await sibling.goto(origin+'/#school');await sibling.locator('[data-task-entry-experiment]').waitFor();
    }
    await page.getByRole('button',{name:/Analytics is on/}).click();await page.getByRole('button',{name:'No thanks',exact:true}).click();
    assert.equal(await page.evaluate(key=>fixtureStorage.getItem(key),STATE_KEY),null);
    assert.equal(await task.textContent(),'New task');
    if(sibling){
     await sibling.waitForFunction(()=>document.querySelector('[aria-label*="Analytics is off"]'));
     assert.equal(await sibling.evaluate(key=>fixtureStorage.getItem(key),STATE_KEY),null);await sibling.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[],'local mode sends no external requests');
   }finally{try{if(page)await page.close();}finally{await context.close();}}
  }
 }finally{
  if(browser)await browser.close();if(browserServer)await browserServer.close();if(http)await new Promise(r=>http.close(r));
  for(const entry of owned){
   if(entry.pid!==process.pid){try{process.kill(entry.pid,0);entry.processClosed=false;}catch{entry.processClosed=true;}}
   try{await fetch(`http://127.0.0.1:${entry.port}`,{signal:AbortSignal.timeout(500)});entry.portClosed=false;}catch{entry.portClosed=true;}
  }
  await writeFile(resolve(directory,'ownership.json'),JSON.stringify(owned,null,2));
  assert.ok(owned.every(x=>x.portClosed&&x.processClosed!==false),'owned ports and Chromium must close');
 }
});
