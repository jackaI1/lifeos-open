import test from'node:test';import assert from'node:assert/strict';import{spawn}from'node:child_process';import{createServer}from'node:http';import{once}from'node:events';import{mkdtemp,rm,mkdir,writeFile}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{chromium}from'playwright';
test('real microphone page streams fake recorded audio through Whisper and flushes Finish',{timeout:180000},async()=>{
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const dir=await mkdtemp(join(tmpdir(),'lifeos-live-browser-')),origin=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['src/local/main.ts'],{env:{...process.env,PORT:String(port),APP_ORIGIN:origin,LIFEOS_DATABASE:join(dir,'workspace.sqlite'),WHISPER_MODEL:'tiny.en'},stdio:['ignore','pipe','pipe']});
 let browser,context,page,failed=true,log='';child.stdout.on('data',d=>{log=(log+d).slice(-2000);});child.stderr.on('data',d=>{log=(log+d).slice(-2000);});
 try{
  await mkdir('.runtime/voice-browser',{recursive:true});await writeFile('.runtime/voice-browser/process.json',JSON.stringify({owner:'voice microphone integration fixture',pid:child.pid,startedAt:new Date().toISOString(),port,cleanup:`kill -TERM ${child.pid}; test finally waits for child exit and verifies port` }));
  const deadline=Date.now()+20000;while(!log.includes('LifeOS standalone')&&Date.now()<deadline){if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}assert.match(log,/LifeOS standalone/);
  browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+resolve('test/fixtures/whisper/jfk.wav')]});context=await browser.newContext({permissions:['microphone']});page=await context.newPage();
  await page.goto(origin+'/live-voice.html');await page.getByRole('button',{name:'Start microphone'}).click();await page.locator('#transcript li').first().waitFor({timeout:90000});await page.getByRole('button',{name:'Finish recording'}).click();await page.getByRole('status').filter({hasText:'Finished. Last audio chunk flushed.'}).waitFor({timeout:90000});
  assert.ok(await page.locator('#transcript li').count());assert.ok(await page.getByRole('button',{name:'Start microphone'}).isEnabled());failed=false;
 }finally{
  if(failed){if(page){await mkdir('test-results/voice',{recursive:true});await page.screenshot({path:'test-results/voice/failure.png'}).catch(()=>{});}console.error(log.slice(-1500));}
  await page?.close();await context?.close();await browser?.close();if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill('SIGTERM');const escalation=setTimeout(()=>child.kill('SIGKILL'),5000);try{await ended;}finally{clearTimeout(escalation);}}
  await assert.rejects(fetch(origin+'/api/health'));await rm(dir,{recursive:true,force:true});await rm('.runtime/voice-browser/process.json',{force:true});
 }
});
