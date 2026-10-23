import '../tools/hosted-app.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {buildHostedAssets} from '../tools/build-hosted-assets.mjs';
test('public deployment binds only static assets and origins with no active cloud code',async()=>{
 const config=JSON.parse(await readFile('wrangler.public.example.jsonc','utf8'));
 assert.deepEqual(Object.keys(config.vars).sort(),['DEMO_ORIGIN','PARENT_ORIGIN']);
 for(const name of ['durable_objects','migrations','d1_databases','r2_buckets','kv_namespaces','queues','services','ai'])assert.equal(config[name],undefined,name);
 assert.equal(config.assets.binding,'ASSETS');assert.equal(config.assets.not_found_handling,'none');assert.equal(config.assets.html_handling,'none');assert.ok(Array.isArray(config.assets.run_worker_first));assert.ok(!config.assets.run_worker_first.includes('/*'),'Authored assets must bypass Worker execution');
 assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);assert.equal(config.observability.enabled,false);
 const source=await readFile('src/hosted/worker.ts','utf8');assert.doesNotMatch(source,/\bimport\b|DurableObject|HostedDatabase|\.storage\b/);
});
test('hosted asset preparation rewrites only its generated shell and secures CDN responses',async()=>{
 const owned=await mkdtemp(resolve(tmpdir(),'lifeos-static-assets-test-'));
 try{
  const source=resolve(owned,'source'),directory=resolve(owned,'output');await mkdir(source);
  const original='<html><script type="module" src="/app.js"></script></html>';
  await writeFile(resolve(source,'index.html'),original);await writeFile(resolve(source,'app.js'),'// authored app');
  await buildHostedAssets({source,directory,demoOrigin:'https://demo.example.test',parentOrigin:'https://owner.example.test',requireBrowserEngine:false});
  assert.equal(await readFile(resolve(source,'index.html'),'utf8'),original);
  assert.match(await readFile(resolve(directory,'index.html'),'utf8'),/src="\/demo-bootstrap\.js"/);
  const headers=await readFile(resolve(directory,'_headers'),'utf8');assert.match(headers,/frame-ancestors https:\/\/owner\.example\.test/);assert.match(headers,/script-src 'self' 'wasm-unsafe-eval'/);assert.match(headers,/microphone=\(self\)/);assert.doesNotMatch(headers,/'unsafe-eval'|Set-Cookie|Access-Control-Allow-Origin: \*/);
  await assert.rejects(()=>buildHostedAssets({source,directory,demoOrigin:'https://demo.example.test',parentOrigin:'https://demo.example.test',requireBrowserEngine:false}));
 }finally{await rm(owned,{recursive:true,force:true});}
});
