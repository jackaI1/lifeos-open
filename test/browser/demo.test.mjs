import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {chromium} from 'playwright';

// Serve the same browser-only demo bootstrap used by the public site.
test('public demo navigation, task lifecycle and basic accessibility', {timeout:120000}, async () => {
 const root=resolve('public');
 const mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml'};
 const server=createServer(async(req,res)=>{
  try { const path=new URL(req.url,'http://local').pathname; const file=resolve(root,'.'+(path==='/'?'/index.html':path));
   if (!file.startsWith(root+'/')) {res.writeHead(403).end();return;}
   let body=await readFile(file); if(path==='/') body=Buffer.from(body.toString().replace('src="/app.js"','src="/demo-bootstrap.js"'));
   res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream'}).end(body);
  } catch {res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser,context,page,failed=true;
 try {
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch(); context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.tracing.start({screenshots:true,snapshots:true}); page=await context.newPage();
  await page.goto(origin); await page.locator('#main h1').waitFor();
  assert.ok(await page.title()); assert.equal(await page.locator('main').count(),1);
  assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).count(),1);
  for (const screen of ['today','school','finances','settings']) {
   const link=page.locator(`${screen==='settings'?'#settings-navigation':'#navigation'} a[href="#${screen}"]`);
   await link.click(); await page.waitForFunction(id=>document.querySelector(`a[href="#${id}"][aria-current="page"]`),screen); await page.locator('#main h1').waitFor();
   assert.ok((await page.locator('#main h1').first().innerText()).trim(),screen);
  }
  await page.goto(`${origin}/#school`); await page.locator('[data-task-entry-experiment]').click();
  await page.getByRole('textbox',{name:'Task title'}).fill('Smoke test task');
  await page.getByRole('button',{name:'Save task',exact:true}).click();
  await page.locator('#dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Mark Smoke test task complete'}).click();
  await page.getByRole('button',{name:'Complete task',exact:true}).click();
  await page.locator('#dialog').waitFor({state:'hidden'});
  await page.waitForFunction(async()=>{const b=await(await fetch('/api/bootstrap')).json();return b.records.task.some(t=>t.data.title==='Smoke test task' && t.data.status==='complete');});
  await page.reload(); await page.locator('[data-task-entry-experiment]').waitFor(); await page.waitForFunction(async()=>{const b=await(await fetch('/api/bootstrap')).json();return b.records.task.some(t=>t.data.title==='Smoke test task' && t.data.status==='complete');});
  failed=false;
 } finally {
  if(context) { if(failed) {await mkdir('test-results/browser',{recursive:true}); if(page) await page.screenshot({path:'test-results/browser/failure.png'}).catch(()=>{}); await context.tracing.stop({path:'test-results/browser/trace.zip'});} else await context.tracing.stop(); await context.close(); }
  if(browser) await browser.close(); await new Promise(resolve=>server.close(resolve));
 }
});
