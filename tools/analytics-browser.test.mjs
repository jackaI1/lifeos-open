import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

// No app server, live container, credentials or user data: serve the built module
// through Playwright routing and intercept every Google request.
test('analytics banner and consent boundaries in Chromium',async()=>{
 const directory=new URL('../.runtime/analytics-browser/',import.meta.url);
 await mkdir(directory,{recursive:true});
 const server=await chromium.launchServer({headless:true,host:'127.0.0.1'});
 let browser,ownership;
 try{
 const pid=server.process().pid,port=Number(new URL(server.wsEndpoint()).port);
 ownership={owner:'analytics browser test',pid,start:execFileSync('ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8'}).trim(),port,cleanup:'browserServer.close() in finally',closed:false};
 await writeFile(new URL('ownership.json',directory),JSON.stringify(ownership,null,2));
  browser=await chromium.connect(server.wsEndpoint());
  for(const mode of ['configured','unconfigured','gpc','bootstrap']){
   const context=await browser.newContext({viewport:{width:390,height:844}});
   let page;
   const google=[];
   try{
    if(mode==='bootstrap')await context.addInitScript(()=>Object.defineProperty(navigator,'serviceWorker',{value:{addEventListener(){},register:async()=>({}),ready:Promise.resolve(),controller:{scriptURL:'https://demo.test/browser-demo-sw.js'}}}));
    if(mode==='gpc')await context.addInitScript(()=>Object.defineProperty(navigator,'globalPrivacyControl',{value:true}));
    await context.route('**/*',async route=>{
     const url=new URL(route.request().url());
     if(url.hostname!=='demo.test'){
      google.push(url.href);
      return route.fulfill({status:200,contentType:'application/javascript',body:''});
     }
     if(['/demo-bootstrap.js','/browser-demo-transport.js','/demo-storage.js'].includes(url.pathname))return route.fulfill({contentType:'application/javascript',body:await readFile(new URL('../public'+url.pathname,import.meta.url),'utf8')});
     if(url.pathname==='/vendor/browser-demo/client.mjs')return route.fulfill({contentType:'application/javascript',body:'export const createBrowserWorkspace=()=>({ready:Promise.resolve(),fetch:async()=>new Response(JSON.stringify({ok:true}),{headers:{"content-type":"application/json"}})});'});
     if(url.pathname==='/app.js')return route.fulfill({contentType:'application/javascript',body:'window.appReady=true;'});
     if(url.pathname==='/vendor/analytics.mjs')return route.fulfill({contentType:'application/javascript',body:await readFile(new URL('../public/vendor/analytics.mjs',import.meta.url),'utf8')});
     if(url.pathname==='/analytics-consent.css')return route.fulfill({contentType:'text/css',body:await readFile(new URL('../public/analytics-consent.css',import.meta.url),'utf8')});
     return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${mode==='unconfigured'?'':'<meta name="lifeos-analytics-gtm" content="GTM-ABC1234"><meta name="lifeos-analytics-ga4" content="G-ABCDE12345">'}</head><body><h1>LifeOS public demo fixture</h1></body></html>`});
    });
    page=await context.newPage();
    const start=async()=>{
     await page.goto('about:blank');
     await page.goto('https://demo.test/?private=NEVER_SEND#school?task=SECRET');
     if(mode==='bootstrap')return page.evaluate(()=>import('/demo-bootstrap.js'));
     await page.evaluate(async()=>{const {startAnalytics}=await import('/vendor/analytics.mjs');window.fixture=startAnalytics(window,localStorage);});
    };
    await start();
    if(mode==='bootstrap'){
     assert.equal(await page.evaluate(()=>window.appReady),true);
     const endpoint='https://www.google-analytics.com/g/collect?v=2';
     const send=()=>page.evaluate(async url=>{try{return (await fetch(url,{method:'POST',body:'synthetic-event'})).ok;}catch{return false;}},endpoint);
     assert.equal(await send(),false);assert.equal(google.length,0);
     await page.getByRole('button',{name:'Allow analytics',exact:true}).click();
     assert.equal(await send(),true);
     assert.ok(google.some(url=>url.includes('/g/collect')));
     await page.evaluate(()=>fetch('/api/records/task/SECRET',{method:'PUT',body:JSON.stringify({version:0,data:{title:'PRIVATE CONTENT'}})}));
     const events=await page.evaluate(()=>window.dataLayer.filter(e=>e.event));
     assert.ok(events.some(e=>e.event==='item_created'&&e.item_type==='task'));
     assert.equal(JSON.stringify(events).includes('PRIVATE CONTENT'),false);
     assert.equal(google.some(url=>url.includes('/api/')),false);
     await page.getByRole('button',{name:/Analytics is on/}).click();
     await page.getByRole('button',{name:'No thanks',exact:true}).click();
     const count=google.length;assert.equal(await send(),false);assert.equal(google.length,count);
     continue;
    }
    if(mode==='unconfigured'){
     assert.equal(await page.evaluate(()=>window.fixture),null);
     assert.equal(await page.locator('.analytics-consent-root').count(),0);
     assert.equal(google.length,0);
     continue;
    }
    if(mode==='bootstrap')await context.addInitScript(()=>Object.defineProperty(navigator,'serviceWorker',{value:{addEventListener(){},register:async()=>({}),ready:Promise.resolve(),controller:{scriptURL:'https://demo.test/browser-demo-sw.js'}}}));
    if(mode==='gpc'){
     assert.equal(await page.locator('.analytics-consent').count(),0);
     await page.evaluate(()=>window.fixture.analytics.grant());
     assert.equal(await page.evaluate(()=>window.fixture.analytics.consent()),'denied');
     assert.equal(google.length,0);
     continue;
    }
    await page.getByRole('region',{name:'Help improve this demo?'}).waitFor();
    assert.equal(google.length,0);
    assert.equal(await page.evaluate(()=>window['ga-disable-G-ABCDE12345']),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'phone banner does not overflow');
    await page.screenshot({path:new URL('banner-phone.png',directory).pathname});
    await page.getByRole('button',{name:'No thanks',exact:true}).click();
    await page.getByRole('button',{name:/Analytics is off/}).waitFor();
    await start();
    await page.getByRole('button',{name:/Analytics is off/}).click();
    assert.equal(google.length,0);
    await page.getByRole('button',{name:'Allow analytics',exact:true}).click();
    await page.waitForFunction(()=>window.fixture.analytics.consent()==='granted');
    await page.waitForFunction(()=>performance.getEntriesByType('resource').some(r=>r.name.includes('googletagmanager.com')));
    assert.equal(google.length,1);
    assert.equal(await page.evaluate(()=>window['ga-disable-G-ABCDE12345']),false);
    const layer=await page.evaluate(()=>window.dataLayer.filter(e=>e.event));
    assert.equal(layer.filter(e=>e.event==='view_changed').length,1);
    assert.equal(layer.find(e=>e.event==='view_changed').page_location,'https://demo.test/#school');
    assert.equal(JSON.stringify(layer).includes('SECRET'),false);
    await start();
    await page.getByRole('button',{name:/Analytics is on/}).click();
    await page.getByRole('button',{name:'No thanks',exact:true}).click();
    assert.equal(await page.evaluate(()=>window['ga-disable-G-ABCDE12345']),true);
    const count=await page.evaluate(()=>window.dataLayer.length);
    await page.evaluate(()=>window.fixture.analytics.track('item_created',{item_type:'task'}));
    assert.equal(await page.evaluate(()=>window.dataLayer.length),count);
    const beforeReload=google.length;
    await start();
    await page.getByRole('button',{name:/Analytics is off/}).waitFor();
    assert.equal(google.length,beforeReload,'stored decline requests no container');
   }finally{
    try{if(page)await page.close();}finally{await context.close();}
   }
  }
 }finally{
  try{if(browser)await browser.close();}finally{
   await server.close();
   if(ownership){ownership.closed=true;await writeFile(new URL('ownership.json',directory),JSON.stringify(ownership,null,2));}
  }
 }
});
