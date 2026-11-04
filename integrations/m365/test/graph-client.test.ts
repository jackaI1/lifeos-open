import test from 'node:test';
import assert from 'node:assert/strict';
import {GraphClient, GraphError, parseRetryAfter} from '../src/graph-client.ts';

type Reply = Response | Error;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', ...headers}});

function harness(replies: Reply[], options: Partial<ConstructorParameters<typeof GraphClient>[0]> = {}) {
  const calls: {url: string; init: RequestInit}[] = [];
  const sleeps: number[] = [];
  const queue = [...replies];
  const client = new GraphClient({
    getToken: async (o) => (o?.forceRefresh ? 'fresh-token' : 'old-token'),
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({url, init});
      const next = queue.shift();
      if (!next) throw new Error('unexpected extra request');
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.999,
    ...options,
  });
  return {client, calls, sleeps};
}

test('sends a bearer token and parses JSON', async () => {
  const {client, calls} = harness([json(200, {id: 'u1', displayName: 'Example User'})]);
  assert.equal((await client.me()).displayName, 'Example User');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer old-token');
  assert.match(calls[0].url, /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\?/);
});

test('returns undefined for 204 No Content', async () => {
  const {client} = harness([new Response(null, {status: 204})]);
  assert.equal(await client.deleteListItem('s', 'l', '1'), undefined);
});

test('429 honours Retry-After, then succeeds', async () => {
  const {client, sleeps} = harness([json(429, {error: {code: 'tooManyRequests'}}, {'retry-after': '7'}), json(200, {id: 'u1'})]);
  await client.me();
  assert.deepEqual(sleeps, [7000]);
});

test('exponential backoff with jitter doubles per attempt and is capped', async () => {
  const replies = [503, 503, 503, 503, 503].map(() => json(503, {error: {code: 'serviceNotAvailable'}}));
  const {client, sleeps} = harness(replies, {baseDelayMs: 1000, maxDelayMs: 5000, random: () => 0.5});
  await assert.rejects(client.me(), (error: GraphError) => error.status === 503 && error.attempts === 5);
  // floor(0.5 * min(5000, 1000 * 2^attempt)) for attempts 0..3
  assert.deepEqual(sleeps, [500, 1000, 2000, 2500]);
});

test('a Retry-After larger than the jittered delay wins but never exceeds the cap', async () => {
  const {client, sleeps} = harness([json(429, {}, {'retry-after': '120'}), json(200, {id: 'u1'})], {maxDelayMs: 10_000});
  await client.me();
  assert.deepEqual(sleeps, [10_000]);
});

test('does not retry client errors and surfaces Graph error details', async () => {
  const {client, calls} = harness([json(403, {error: {code: 'accessDenied', message: 'Insufficient privileges', innerError: {'request-id': 'req-123'}}})]);
  await assert.rejects(client.me(), (error: GraphError) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, 'accessDenied');
    assert.equal(error.requestId, 'req-123');
    assert.match(error.message, /Insufficient privileges/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test('non-JSON error bodies still produce a GraphError', async () => {
  const {client} = harness([new Response('<html>bad gateway</html>', {status: 400})]);
  await assert.rejects(client.me(), (error: GraphError) => error.code === 'http400');
});

test('401 refreshes the token once and retries without consuming a retry', async () => {
  const {client, calls, sleeps} = harness([json(401, {error: {code: 'InvalidAuthenticationToken'}}), json(200, {id: 'u1'})], {maxRetries: 0});
  await client.me();
  assert.equal((calls[1].init.headers as Record<string, string>).authorization, 'Bearer fresh-token');
  assert.deepEqual(sleeps, []);
});

test('a second 401 is reported rather than looping', async () => {
  const {client, calls} = harness([json(401, {}), json(401, {})]);
  await assert.rejects(client.me(), (error: GraphError) => error.status === 401);
  assert.equal(calls.length, 2);
});

test('network failures retry idempotent calls only', async () => {
  const reset = Object.assign(new TypeError('fetch failed'), {cause: {code: 'ECONNRESET'}});
  const get = harness([reset, json(200, {id: 'u1'})]);
  await get.client.me();
  assert.equal(get.calls.length, 2);

  const post = harness([reset]);
  await assert.rejects(post.client.createListItem('s', 'l', {Title: 'x'}), (error: GraphError) => error.code === 'networkError');
  assert.equal(post.calls.length, 1);
});

test('502/504 retry for PATCH but not for POST; 503 retries for both', async () => {
  const patch = harness([json(504, {}), json(200, {Title: 'x'})]);
  await patch.client.updateListItemFields('s', 'l', '1', {Title: 'x'});
  assert.equal(patch.calls.length, 2);

  const post502 = harness([json(502, {})]);
  await assert.rejects(post502.client.createListItem('s', 'l', {}), (error: GraphError) => error.status === 502);
  assert.equal(post502.calls.length, 1);

  const post503 = harness([json(503, {}), json(201, {id: '9'})]);
  assert.equal((await post503.client.createListItem('s', 'l', {})).id, '9');
});

test('getAll follows nextLink pages and reuses the auth header', async () => {
  const next = 'https://graph.microsoft.com/v1.0/sites/s/lists?$skiptoken=abc';
  const {client, calls} = harness([
    json(200, {value: [{id: 'a', displayName: 'A'}], '@odata.nextLink': next}),
    json(200, {value: [{id: 'b', displayName: 'B'}]}),
  ]);
  assert.deepEqual((await client.getLists('s')).map((l) => l.id), ['a', 'b']);
  assert.equal(calls[1].url, next);
});

test('getAll refuses a nextLink that points at another origin, so the token is never leaked', async () => {
  const {client, calls} = harness([json(200, {value: [], '@odata.nextLink': 'https://evil.example/steal'})]);
  await assert.rejects(client.getLists('s'), /Refusing to send Graph credentials/);
  assert.equal(calls.length, 1);
});

test('POST bodies are JSON encoded with a content type', async () => {
  const {client, calls} = harness([json(201, {id: '1'})]);
  await client.createListItem('s', 'l', {Title: 'Essay'});
  const init = calls[0].init;
  assert.equal((init.headers as Record<string, string>)['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(String(init.body)), {fields: {Title: 'Essay'}});
});

test('onRetry reports each retry', async () => {
  const seen: string[] = [];
  const {client} = harness([json(429, {}), json(200, {id: 'u1'})], {onRetry: (info) => seen.push(`${info.attempt}:${info.reason}`)});
  await client.me();
  assert.deepEqual(seen, ['1:HTTP 429']);
});

test('parseRetryAfter reads seconds, HTTP dates and rejects junk', () => {
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter('1.5'), 1500);
  assert.equal(parseRetryAfter('Wed, 21 Oct 2026 07:28:10 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')), 10_000);
  assert.equal(parseRetryAfter('Wed, 21 Oct 2020 07:28:10 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')), 0);
  assert.equal(parseRetryAfter('soon'), null);
  assert.equal(parseRetryAfter(null), null);
});
