import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedRuntime} from './hosted-test-runtime.mjs';
// Replaces the retired hosted-SQLite fixture: the public host now has no storage.
// Standalone/private database and authentication tests remain separate and intact.
test('Cloudflare transport serves static assets and rejects writes without a session',async()=>{
 const runtime=await createHostedRuntime();const {mf,origin,parent,blocked}=runtime;
 try{
  for(const path of ['/','/index.html','/demo-bootstrap.js','/vendor/browser-demo/client.mjs','/vendor/browser-demo/worker.mjs','/vendor/browser-demo/sql-wasm.wasm','/demo-lecture.wav']){
   const response=await mf.dispatchFetch(origin+path);assert.equal(response.status,200,path);assert.equal(response.headers.get('set-cookie'),null,path);
   assert.ok(response.headers.get('content-security-policy')?.includes('frame-ancestors '+parent),path);assert.equal(response.headers.get('x-content-type-options'),'nosniff',path);
   if(path==='/'||path==='/index.html')assert.match(await response.text(),/src="\/demo-bootstrap\.js"/);else await response.body?.cancel();
  }
  for(const path of ['/api','/api/session','/api/bootstrap','/api/private-notes/example','/api/uploads','/api/jobs','/auth/google'])for(const method of ['GET','POST','PUT','DELETE','PATCH']){
   const response=await mf.dispatchFetch(origin+path,{method,...(method==='GET'?{}:{body:'VISITOR-CONTENT-MUST-NOT-BE-STORED'})});assert.ok(response.status>=400,method+' '+path);assert.equal(response.headers.get('set-cookie'),null);await response.body?.cancel();
  }
  for(const path of ['/','/index.html','/demo-bootstrap.js','/vendor/browser-demo/sql-wasm.wasm'])for(const method of ['POST','PUT','DELETE']){
   const response=await mf.dispatchFetch(origin+path,{method,body:'VISITOR-UPLOAD'});assert.ok([403,404,405].includes(response.status),method+' '+path+' '+response.status);assert.equal(response.headers.get('set-cookie'),null);await response.body?.cancel();
   const unchanged=await mf.dispatchFetch(origin+path);assert.equal(unchanged.status,200,'Write must not alter authored asset');await unchanged.body?.cancel();
  }
  assert.deepEqual(blocked,[],'Static host must not invoke an external integration');
 }finally{await runtime.dispose();}
});
