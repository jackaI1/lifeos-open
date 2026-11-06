import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createService} from '../src/local/service.ts';
import {checkWorkspace} from '../tools/kubernetes-api-smoke.mjs';

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
