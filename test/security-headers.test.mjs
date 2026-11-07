import test from 'node:test';import assert from 'node:assert/strict';import worker from '../src/hosted/worker.ts';
const origin='https://demo.example.invalid',env={DEMO_ORIGIN:origin,PARENT_ORIGIN:'https://jacklai.ca',ASSETS:{fetch:async()=>new Response('<html><script src="/app.js"></script></html>',{headers:{'content-type':'text/html'}})}};
test('public Worker sets CSP framing, referrer, and content-type protections',async()=>{
 const r=await worker.fetch(new Request(origin),env);assert.equal(r.status,200);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.match(r.headers.get('content-security-policy'),/frame-ancestors https:\/\/jacklai.ca/);assert.match(r.headers.get('content-security-policy'),/object-src 'none'/);assert.match(r.headers.get('content-type'),/text\/html/);assert.equal(r.headers.get('set-cookie'),null);
});
test('public Worker rejects every remote API write without reading its payload',async()=>{
 for(const method of ['POST','PUT','PATCH','DELETE']){const r=await worker.fetch(new Request(origin+'/api/records/task/fictional',{method,body:'{"title":"<script>bad()</script>"}'}),env);assert.equal(r.status,405);}
 assert.equal((await worker.fetch(new Request(origin+'/api/bootstrap'),env)).status,403);
});
