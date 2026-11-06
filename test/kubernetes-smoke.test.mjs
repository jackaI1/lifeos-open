import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createService} from '../src/local/service.ts';
import {createServer} from 'node:http';
import {checkWorkspace, createClusterRequest} from '../tools/kubernetes-api-smoke.mjs';

test('deployment smoke check verifies a saved note across fresh SQLite sessions', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'lifeos-kubernetes-'));
 const database = join(directory, 'workspace.sqlite');
 let app;
 const request = (path, options) => app.fetch(new Request(app.origin + path, options));
 try {
  app = await createService({database});
  await checkWorkspace({request, phase:'write', id:'fictional-deployment-note'});
  await app.close();
  app = await createService({database});
  await checkWorkspace({request, phase:'verify', id:'fictional-deployment-note'});
  await assert.rejects(checkWorkspace({request, phase:'verify', id:'missing-deployment-note'}));
  await assert.rejects(checkWorkspace({request, phase:'unknown', id:'fictional-deployment-note'}), /phase/);
 } finally {
  await app?.close();
  await rm(directory, {recursive:true, force:true});
 }
});


test('cluster HTTP client sends the loopback Host header to a different service address', async () => {
 const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({host:request.headers.host, origin:request.headers.origin, method:request.method, body}));
 });
 let port;
 try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  console.log(`Owned cluster-client HTTP fixture: pid=${process.pid}, started=${new Date().toISOString()}, port=${port}, cleanup=server.closeAllConnections() and server.close() in finally`);
  const request = createClusterRequest('http://127.0.0.1:' + port);
  const response = await request('/api/example', {method:'PUT', headers:{origin:'http://127.0.0.1:8787'}, body:'{"example":true}'});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {host:'127.0.0.1:8787', origin:'http://127.0.0.1:8787', method:'PUT', body:'{"example":true}'});
  assert.equal((await (await request('/api/health', {headers:{Host:'untrusted.invalid'}})).json()).host, 'untrusted.invalid');
 } finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
 }
 assert.equal(server.listening, false);
 console.log(`Closed owned cluster-client HTTP fixture: pid=${process.pid}, port=${port}`);
});
