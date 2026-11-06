import {chromium} from 'playwright';
import robotsParser from 'robots-parser';
import {writeFile, rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Inventory only explicitly supplied public pages, never follow links automatically.
export async function inventory({base, paths=['/'], output='page-inventory.json', delayMs=1000}) {
 const origin = new URL(base).origin, agent = 'LifeOSPageInventory';
 const browser = await chromium.launch();
 try {
  const context = await browser.newContext({userAgent:agent});
  try {
   const page = await context.newPage();
   // Only the requested document is needed; block third-party and background traffic.
   let permittedUrl;
   await page.route('**/*', route => route.request().resourceType() === 'document' && route.request().url() === permittedUrl ? route.continue() : route.abort());
   let last = 0;
   async function visit(url) {
    let failure; permittedUrl=url;
    for (let attempt=0;attempt<3;attempt++) {
     await new Promise(resolve=>setTimeout(resolve,Math.max(0,delayMs-(Date.now()-last)))); last=Date.now();
     try { const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});
      if (new URL(page.url()).origin!==origin) throw new Error('Cross-origin redirect refused');
      if (response && response.status() < 500 && response.status() !== 429) return response;
      failure=new Error(`HTTP ${response?.status()}`);
     } catch (error) { failure=error; }
    }
    throw failure;
   }
   const robotsUrl=origin+'/robots.txt'; const response=await visit(robotsUrl);
   if (!response || (response.status()!==404 && !response.ok())) throw new Error('Cannot safely read robots.txt');
   const rules=robotsParser(robotsUrl,response.status()===404?'':await response.text());
   const rows=[];
   for (const path of [...new Set(paths)]) {
    const url=new URL(path,origin); if (url.origin!==origin) throw new Error('Only same-origin pages are allowed');
    if (!rules.isAllowed(url.href,agent)) continue;
    const result=await visit(url.href); if (!result.ok()) throw new Error(`HTTP ${result.status()} for ${url.href}`);
    rows.push({url:url.href,title:await page.title(),heading:await page.locator('h1').first().textContent().catch(()=>null)});
   }
   rows.sort((a,b)=>a.url.localeCompare(b.url));
   await writeFile(output+'.tmp',JSON.stringify(rows,null,2)+'\n'); await rename(output+'.tmp',output);
   return rows;
  } finally { await context.close(); }
 } finally { await browser.close(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 const [base,...paths]=process.argv.slice(2); if (!base) throw new Error('Usage: node tools/page-inventory.mjs https://example.com /');
 console.log(`Saved ${(await inventory({base,paths:paths.length?paths:['/']})).length} pages to page-inventory.json`);
}
