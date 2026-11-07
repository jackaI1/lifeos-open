import{chromium}from'playwright';import{readFile,mkdir,writeFile}from'node:fs/promises';import assert from'node:assert/strict';
const state=JSON.parse(await readFile('.runtime/internal-desk/budibase.json','utf8')),origin=process.env.BUDIBASE_URL??'http://127.0.0.1:10000';
let browser,context,reviewContext,page,failed=true;
try{
 browser=await chromium.launch({headless:true});context=await browser.newContext();
 const login=await context.request.post(origin+'/api/global/auth/default/login',{data:{username:process.env.BB_ADMIN_USER_EMAIL,password:process.env.BB_ADMIN_USER_PASSWORD}});assert.ok(login.ok());
 const me=await(await context.request.get(origin+'/api/global/self')).json();const key=await(await context.request.get(origin+'/api/global/self/api_key')).json();
 await context.setExtraHTTPHeaders({'x-csrf-token':me.csrfToken});
 const headers={'x-budibase-api-key':key.apiKey,'x-budibase-app-id':state.productionId};
 const search=async(table)=>{const r=await context.request.post(`${origin}/api/public/v1/tables/${table}/rows/search`,{headers,data:{query:{}}});assert.ok(r.ok(),`search HTTP ${r.status()}`);return(await r.json()).data;};
 reviewContext=await browser.newContext();
 const reviewLogin=await reviewContext.request.post(origin+'/api/global/auth/default/login',{data:{username:process.env.BB_REVIEWER_USER_EMAIL,password:process.env.BB_REVIEWER_USER_PASSWORD}});assert.ok(reviewLogin.ok());
 const reviewSelf=await(await reviewContext.request.get(origin+'/api/global/self')).json();await reviewContext.setExtraHTTPHeaders({'x-csrf-token':reviewSelf.csrfToken});
 const appUrl=new URL(new URL(state.appUrl,origin).pathname.replace(/\/$/,'')+'/',origin);appUrl.hash='/review/'+encodeURIComponent(state.rowId);
 const packageResponse=await reviewContext.request.get(`${origin}/api/applications/${state.productionId}/appPackage`,{headers:{'x-budibase-app-id':state.productionId,referer:appUrl.href}});assert.ok(packageResponse.ok(),`published package HTTP ${packageResponse.status()}`);const appPackage=await packageResponse.json();assert.equal(appPackage.screens?.length,5,'reviewer must have access to all five published screens');
 page=await reviewContext.newPage();await page.goto(appUrl.href);
 // Match the pinned release's child-app prefix and hash-based screen routes.
 await page.getByText('Review fictional deliverable',{exact:true}).waitFor({timeout:60000});
 const title=page.getByLabel('Title',{exact:true});await title.fill('Fictional desk node design reviewed');
 await page.getByRole('button',{name:'Save review',exact:true}).click();
 await assertEventually(async()=>{const rows=await search(state.tables.Deliverables);return rows.some(r=>r.Title==='Fictional desk node design reviewed');});
 await assertEventually(async()=>{const rows=await search(state.tables.Audit);return rows.some(r=>r.Title==='Fictional desk node design reviewed'&&r.SourceRow===state.rowId);});
 const citations=await search(state.tables.FieldCitations);assert.equal(citations.length,5);
 const assets=await search(state.tables.Assets);assert.equal(assets.length,2);assert.deepEqual(assets.map(a=>a.Network).sort(),['sewer','water']);assert.ok(assets.every(a=>a.Inspected));
 const cleanup=await context.request.post(`${origin}/api/public/v1/views/${state.cleanupView}/rows/search`,{headers,data:{query:{}}});assert.ok(cleanup.ok());assert.equal((await cleanup.json()).data.length,1);
 await mkdir('test-results/internal-desk',{recursive:true});await page.screenshot({path:'test-results/internal-desk/review.png',fullPage:true});await writeFile('test-results/internal-desk/results.json',JSON.stringify({reviewSaved:true,auditCreated:true,citations:citations.length,relationalAssets:assets.length,cleanupRows:1,screens:state.screens}));failed=false;
}finally{if(failed&&page){await mkdir('test-results/internal-desk',{recursive:true});await page.screenshot({path:'test-results/internal-desk/failure.png',fullPage:true}).catch(()=>{});console.error('Budibase page:',page.url(),(await page.locator('body').innerText().catch(()=>'' )).slice(0,600));}await page?.close();await reviewContext?.close();await context?.close();await browser?.close();}
async function assertEventually(check){const deadline=Date.now()+60000;while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,250));}throw Error('Budibase data did not reach expected state');}
