import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, writeFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {createDemoServer} from '../src/hosted/server.mjs';

 const fixture = async (t, {shell=true}={}) => {
  const directory = await mkdtemp(join(tmpdir(), 'lifeos-aws-'));
  const assets = join(directory, 'assets');
  await mkdir(join(assets, 'vendor'), {recursive:true});
  if (shell) await writeFile(join(assets, 'index.html'), '<script type="module" src="/app.js"></script>');
  await writeFile(join(assets, 'vendor', 'sql.wasm'), Buffer.from([0,97,115,109]));
  await writeFile(join(directory, 'private.json'), '{"secret":"fixture-outside-assets"}');
  await symlink(join(directory, 'private.json'), join(assets, 'linked.json'));
  const server = createDemoServer({directory:assets, parentOrigin:'https://portfolio.example.invalid'});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  t.diagnostic(`owner=aws-static-host-test pid=${process.pid} start=${execFileSync('ps',['-p',String(process.pid),'-o','lstart='],{encoding:'utf8'}).trim()} port=${port} cleanup=server.close() in t.after`);
  t.after(async () => {
   await new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
   assert.equal(server.listening, false);
   await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`, {signal:AbortSignal.timeout(300)}));
   await rm(directory, {recursive:true,force:true});
  });
  return `http://127.0.0.1:${port}`;
 };
 test('AWS host serves browser bootstrap and the same security policy over HTTP', async t => {
  const origin = await fixture(t), response = await fetch(origin);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /src="\/demo-bootstrap.js"/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors https:\/\/portfolio.example.invalid/);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
 });
 test('AWS host serves WASM bytes with executable MIME and supports bodyless HEAD', async t => {
  const origin = await fixture(t), response = await fetch(origin+'/vendor/sql.wasm');
  assert.equal(response.headers.get('content-type'), 'application/wasm');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0,97,115,109]);
  const head = await fetch(origin+'/vendor/sql.wasm', {method:'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
 });
 test('AWS host rejects workspace API, authentication, writes and non-asset paths', async t => {
  const origin = await fixture(t);
  for (const path of ['/api','/api/records','/auth','/auth/google']) {
   const response = await fetch(origin+path);
   assert.equal(response.status, 403, path);
   assert.match(await response.text(), /browser_only_demo/);
  }
  for (const path of ['/','/api/records','/healthz']) {
   const response = await fetch(origin+path, {method:'POST',body:'must not be stored'});
   assert.equal(response.status, 405, path);
   assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
  for (const path of ['/settings','/missing.js','/.env','/%2e%2e%2fprivate.json','/linked.json']) {
   const response = await fetch(origin+path);
   assert.equal(response.status, 404, path);
   assert.doesNotMatch(await response.text(), /fixture-outside-assets/);
  }
 });
 test('AWS health check succeeds only with a readable generated demo shell', async t => {
  const origin = await fixture(t), response = await fetch(origin+'/healthz');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {status:'ok',mode:'browser-only'});
 });
 test('AWS host rejects invalid parent origins before opening a socket', () => {
  for (const parentOrigin of ['https://portfolio.example.invalid/path','http://public.example.invalid']) {
   assert.throws(() => createDemoServer({directory:'.runtime/nonexistent',parentOrigin}));
  }
 });
 test('AWS health returns unavailable when the generated shell is missing', async t => {
  const origin = await fixture(t, {shell:false});
  const response = await fetch(origin+'/healthz');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {status:'unavailable',mode:'browser-only'});
 });
