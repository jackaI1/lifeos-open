import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createService} from '../src/local/service.ts';

test('typed retrieval questions show citations and abstention on desktop and phone',async()=>{
 let app,browser,browserServer,context,page;
 const owned=[],diagnostics=[],sent=[];
 const server=createServer(async(req,res)=>{
  try{
   const body=['GET','HEAD'].includes(req.method)?undefined:Readable.toWeb(req);
   const response=await app.fetch(new Request(new URL(req.url,app.origin),{method:req.method,headers:req.headers,body,duplex:'half'}));
   res.writeHead(response.status,Object.fromEntries(response.headers));
   if(response.body)for await(const chunk of response.body)res.write(chunk);res.end();
  }catch{res.writeHead(500);res.end('Fixture request failed');}
 });
 const start=pid=>execFileSync('ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8'}).trim();
 await mkdir('.runtime/retrieval',{recursive:true});
 const save=()=>writeFile('.runtime/retrieval/browser-ownership.json',JSON.stringify(owned,null,2));
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,origin=`http://127.0.0.1:${port}`;
  owned.push({owner:'retrieval browser test server',pid:process.pid,start:start(process.pid),port,cleanup:'server.close() in finally',closed:false});await save();
  app=await createService({database:':memory:',origin,env:{RAG_MODE:'local',DEMO_CLOCK:'2026-11-06T10:35:00Z'}});
  browserServer=await chromium.launchServer({headless:true,host:'127.0.0.1'});
  owned.push({owner:'retrieval isolated Chromium',pid:browserServer.process().pid,start:start(browserServer.process().pid),port:Number(new URL(browserServer.wsEndpoint()).port),cleanup:'browser.close() and browserServer.close() in finally',closed:false});await save();
  browser=await chromium.connect(browserServer.wsEndpoint());context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>diagnostics.push(error.message));
  page.on('request',request=>{if(request.method()==='POST'&&/\/api\/assistant\/threads\/[^/]+\/messages$/.test(new URL(request.url()).pathname))sent.push(request.postDataJSON());});
  for(const [name,viewport] of [['desktop',{width:1440,height:900}],['phone',{width:390,height:844}]]){
   await page.setViewportSize(viewport);await page.goto(origin+'/#school?assistant=new',{waitUntil:'networkidle'});
   const input=page.getByRole('textbox',{name:'Message',exact:true});await input.waitFor();assert.equal(await input.isEditable(),true);
   await input.fill('What should I bring to the Systems lab?');await page.getByRole('button',{name:'Send message',exact:true}).click();
   const answer=page.locator('.assistant-message.assistant').last();await answer.filter({hasText:'calendar-event/demo-lab'}).waitFor({timeout:15000});
   assert.match(await answer.innerText(),/safety goggles/);assert.match(await answer.innerText(),/\[1\]/);
   await page.screenshot({path:'.runtime/retrieval/'+name+'.png'});
   await input.fill('Who won the 1987 Antarctic chess championship?');await page.getByRole('button',{name:'Send message',exact:true}).click();
   await page.locator('.assistant-message.assistant').last().filter({hasText:"I don't know"}).waitFor();
   const fit=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(fit.scroll<=fit.width+2);
  }
  await page.setViewportSize({width:1440,height:900});
  await page.goto(origin+'/#school?lectures=demo-course-design',{waitUntil:'networkidle'});
  await page.getByText('Introduction to feedback loops',{exact:true}).click();
  await page.getByRole('button',{name:'Lecture Tutor',exact:true}).click();
  const tutorInput=page.getByRole('textbox',{name:'Message',exact:true});
  await tutorInput.fill('How does a feedback loop influence future inputs?');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.locator('.assistant-message.assistant').last().filter({hasText:'learning-note/demo-feedback'}).waitFor();
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Lecture Tutor',exact:true}).click();
  await page.locator('.assistant-message.assistant').last().filter({hasText:'learning-note/demo-feedback'}).waitFor();
  const resent=page.waitForRequest(request=>request.method()==='POST'&&/\/api\/assistant\/threads\/[^/]+\/messages$/.test(new URL(request.url()).pathname));
  await tutorInput.fill('How does a feedback loop influence future inputs?');await page.getByRole('button',{name:'Send message',exact:true}).click();
  const repeated=(await resent).postDataJSON();
  await page.locator('.assistant-message.assistant').last().filter({hasText:'learning-note/demo-feedback'}).waitFor();
  assert.ok(!repeated.note&&!repeated.slide,'a restored text-only tutor chat never captures notebook images');
  assert.deepEqual(repeated.photoIds,[]);
  await page.waitForFunction(()=>!document.querySelector('button[aria-label="Send message"]').disabled);
  const lectureId=(await app.db.prepare("SELECT id FROM records WHERE kind='lecture'").first()).id;
  await page.evaluate(async lectureId=>{
   const {PrivateStore}=await import('/storage.js'),store=new PrivateStore(),scope='lecture:'+lectureId;
   const last=await store.get('assistant:last:'+scope);
   await store.put('draft:assistant:'+scope+':'+last.id,{token:crypto.randomUUID(),text:'My preserved photo question',useVisibleNotes:true,attachments:[{id:'fictional-old-photo',state:'saved',photo:{image:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E'}}]});
  },lectureId);
  await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Lecture Tutor',exact:true}).click();
  await tutorInput.waitFor();await page.getByRole('button',{name:'Remove attached photo',exact:true}).waitFor();
  const beforeBlocked=sent.length;
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByText('Remove the attached photos to ask about saved text. Your draft is kept.',{exact:true}).waitFor();
  assert.equal(sent.length,beforeBlocked);assert.equal(await tutorInput.inputValue(),'My preserved photo question');
  await page.goto(origin+'/#finances?assistant=new',{waitUntil:'networkidle'});
  assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).getAttribute('readonly'),'');
  await page.goto(origin+'/#support',{waitUntil:'networkidle'});
  assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).getAttribute('readonly'),'');
  assert.ok(await page.locator('.demo-assistant-choice').count()>0,'Support retains its ready-to-send questions');
  assert.deepEqual(diagnostics,[]);
 }finally{
  await page?.close();await context?.close();await browser?.close();await browserServer?.close();
  await new Promise(resolve=>server.close(resolve));await app?.close();
  for(const resource of owned){
   resource.portClosed=await fetch(`http://127.0.0.1:${resource.port}`,{signal:AbortSignal.timeout(500)}).then(()=>false,()=>true);
   if(resource.owner.includes('Chromium')){try{process.kill(resource.pid,0);resource.closed=false;}catch{resource.closed=true;}}
   else resource.closed=!server.listening;
  }
  await save();assert.ok(owned.every(r=>r.closed&&r.portClosed),'all owned browser and server resources close');
 }
});
