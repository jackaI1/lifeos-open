import test from 'node:test';import assert from 'node:assert/strict';
import {publicEntry} from '../src/hosted/public-entry.mjs';
const appOrigin='https://owner.example.test',demoOrigin='https://demo.example.test';
test('published frame renders the shipped Demo title, code/login controls and isolated child',async()=>{
 const response=publicEntry(new Request(appOrigin),{appOrigin,demoOrigin}),html=await response.text();
 assert.match(html,/<h1 class="demo-title">Demo<\/h1>/);assert.match(html,/grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/);assert.match(html,/href="\/auth\/login"/);assert.match(html,/Open-Sourced Code/);assert.match(html,/src="https:\/\/demo.example.test\/"/);assert.match(html,/sandbox="allow-scripts allow-same-origin allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox"/);
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('vary'),'Cookie');assert.match(response.headers.get('content-security-policy'),/frame-src https:\/\/demo.example.test;/);
});
test('published frame cannot serve APIs, writes or same-origin demo configuration',async()=>{
 for(const path of ['/api/session','/auth/login','/app.js'])assert.equal(publicEntry(new Request(appOrigin+path),{appOrigin,demoOrigin}),null);
 assert.equal(publicEntry(new Request(appOrigin,{method:'POST'}),{appOrigin,demoOrigin}),null);assert.equal(publicEntry(new Request(appOrigin),{appOrigin}),null);assert.throws(()=>publicEntry(new Request(appOrigin),{appOrigin,demoOrigin:appOrigin}));
 const head=publicEntry(new Request(appOrigin,{method:'HEAD'}),{appOrigin,demoOrigin});assert.equal(await head.text(),'');
});
