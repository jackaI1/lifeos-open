import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const origin='https://demo.example.test',parent='https://owner.example.test';
async function setup(){
 const {default:worker}=await import('../src/hosted/worker.ts');const assetRequests=[];
 const env={DEMO_ORIGIN:origin,PARENT_ORIGIN:parent,ASSETS:{async fetch(req){assetRequests.push(req);const pathname=new URL(req.url).pathname;try{const body=await readFile(resolve('public',pathname==='/'?'index.html':pathname.slice(1)));return new Response(req.method==='HEAD'?null:body,{headers:{'content-type':['/','/index.html'].includes(pathname)?'text/html':'application/javascript'}});}catch{return new Response('Not found',{status:404});}}}};
 return {worker,env,assetRequests};
}
test('public host serves authored static shell without a visitor session',async()=>{
 const {worker,env,assetRequests}=await setup();
 for(const path of ['/?visitor=ignored','/index.html']){const response=await worker.fetch(new Request(origin+path),env);assert.equal(response.status,200);assert.match(await response.text(),/src="\/demo-bootstrap\.js"/);assert.equal(response.headers.get('set-cookie'),null);assert.match(response.headers.get('content-security-policy'),/frame-ancestors https:\/\/owner\.example\.test(?:;|$)/);assert.equal(response.headers.get('x-frame-options'),null);}
 const asset=await worker.fetch(new Request(origin+'/app.js'),env);assert.equal(asset.status,200);assert.equal(asset.headers.get('set-cookie'),null);
 const head=await worker.fetch(new Request(origin+'/',{method:'HEAD'}),env);assert.equal(head.status,200);assert.equal(await head.text(),'');assert.ok(assetRequests.every(req=>!req.headers.has('cookie')));assert.ok(assetRequests.filter(req=>new URL(req.url).pathname==='/index.html').length>=3,'Shell must fetch exact index asset when HTML handling is disabled');
});
test('public host rejects every API and write before accessing bodies or sessions',async()=>{
 const {worker,env,assetRequests}=await setup();
 for(const path of ['/api','/api/session','/api/bootstrap','/api/private-notes/demo-note','/api/uploads','/api/worker/claim','/auth/google'])for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']){
  const original=new Request(origin+path,{method,...(!['GET','HEAD'].includes(method)?{body:'visitor-private-content'}:{})});
  const request=new Proxy(original,{get(target,key){if(['body','text','json','arrayBuffer','formData','clone','headers'].includes(key))throw Error('Rejected request body or session was accessed');return Reflect.get(target,key,target);}});
  const response=await worker.fetch(request,env);assert.ok(response.status>=400,method+' '+path);assert.equal(response.headers.get('set-cookie'),null);assert.equal(original.bodyUsed,false);
 }
 for(const path of ['/','/index.html','/app.js','/browser-demo-worker.js'])for(const method of ['POST','PUT','PATCH','DELETE']){const req=new Request(origin+path,{method,body:'visitor-content'});assert.equal((await worker.fetch(req,env)).status,405);assert.equal(req.bodyUsed,false);}
 assert.equal(assetRequests.length,0,'Rejected requests must never reach an asset or storage service');
});
test('public host fails closed for unknown origins, configuration and non-assets',async()=>{
 const {worker,env}=await setup();
 for(const url of ['https://owner.example.test/','https://evil.example.test/','http://demo.example.test/'])assert.equal((await worker.fetch(new Request(url),env)).status,404);
 for(const name of ['WORKSPACES','ADMISSION','SESSION_SECRET','DB','GOOGLE_CLIENT_SECRET','LLM_API_KEY'])assert.equal((await worker.fetch(new Request(origin+'/'),{...env,[name]:'unexpected'})).status,503,name);
 for(const path of ['/auth/google','/login','/api/not-real','/missing.js','/private.sqlite','/%2e%2e/secret.js','/_headers'])assert.ok((await worker.fetch(new Request(origin+path),env)).status>=400,path);
 assert.equal((await worker.fetch(new Request(origin+'/'),{...env,PARENT_ORIGIN:origin})).status,503);
});
