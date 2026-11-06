import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {HttpRequest, InvocationContext} from '@azure/functions';
import {createHandlers} from '../src/handlers.ts';
const fixture = JSON.parse(await readFile(new URL('../../../public/demo/today.json', import.meta.url), 'utf8'));
const request = (headers: Record<string, string> = {}) => new HttpRequest({url: 'http://localhost/api/demo/today', method: 'GET', headers});
const context = () => new InvocationContext({functionName: 'test'});

test('serves the phone feed and strips fields outside the public contract', async () => {
  const handlers = createHandlers(async () => ({...fixture, privateNote: 'must not escape'}));
  const response = await handlers.today(request(), context());
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, fixture);
  assert.match((response.headers as Record<string, string>).etag, /^"[a-f0-9]{64}"$/);
});
test('returns 304 for a matching snapshot, including weak and list validators', async () => {
  const handlers = createHandlers(async () => fixture);
  const first = await handlers.today(request(), context());
  const etag = (first.headers as Record<string, string>).etag;
  for (const value of [etag, `"other", W/${etag}`, '*']) {
    const result = await handlers.today(request({'if-none-match': value}), context());
    assert.equal(result.status, 304);
    assert.equal(result.jsonBody, undefined);
  }
  assert.equal((await handlers.today(request({'if-none-match': '"old"'}), context())).status, 200);
});
test('rejects missing, non-fictional and malformed stored feeds', async () => {
  for (const value of [null, {...fixture, fictional: false}, {...fixture, tasks: [{id: 'bad'}]}]) {
    const result = await createHandlers(async () => value).today(request(), context());
    assert.equal(result.status, 503);
    assert.equal((result.headers as Record<string, string>)['cache-control'], 'no-store');
  }
});
test('database failures never disclose connection details or return a stale 304', async () => {
  const handlers = createHandlers(async () => {throw new Error('secret connection password');});
  const result = await handlers.today(request({'if-none-match': '*'}), context());
  assert.equal(result.status, 503);
  assert.doesNotMatch(JSON.stringify(result), /secret|password/);
});
test('readiness checks the feed, including invalid data and outages', async () => {
  assert.deepEqual((await createHandlers(async () => fixture).health(request(), context())).jsonBody, {status: 'ok', fictional: true, schemaVersion: 1});
  for (const load of [async () => null, async () => {throw new Error('SQL down');}]) {
    assert.equal((await createHandlers(load).health(request(), context())).status, 503);
  }
});
