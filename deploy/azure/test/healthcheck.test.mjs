import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHealth } from '../healthcheck.mjs';

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(next.body ?? '', { status: next.status ?? 200 });
  };
  return { fetchImpl, calls };
}

test('accepts a 200 response whose JSON status is ok', async () => {
  const { fetchImpl, calls } = fakeFetch([{ body: JSON.stringify({ status: 'ok', mode: 'browser-only' }) }]);
  const result = await checkHealth('https://demo.example.test', { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'browser-only');
  assert.deepEqual(calls, ['https://demo.example.test/healthz']);
});

test('rejects a 503 from a container that is not ready', async () => {
  const { fetchImpl } = fakeFetch([{ status: 503, body: '{"status":"unavailable"}' }]);
  const result = await checkHealth('https://demo.example.test', { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'HTTP 503');
});

test('rejects a 200 whose body is not the expected JSON', async () => {
  const { fetchImpl } = fakeFetch([{ body: '<html>wrong page</html>' }]);
  const result = await checkHealth('https://demo.example.test', { fetchImpl });
  assert.equal(result.ok, false);
});

test('retries a cold start until the app answers', async () => {
  const { fetchImpl, calls } = fakeFetch([
    new TypeError('fetch failed'),
    { status: 503, body: '' },
    { body: JSON.stringify({ status: 'ok' }) },
  ]);
  const result = await checkHealth('https://demo.example.test', { fetchImpl, attempts: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.attempt, 3);
  assert.equal(calls.length, 3);
});

test('reports the last error after all attempts fail', async () => {
  const { fetchImpl, calls } = fakeFetch([new Error('down'), new Error('down')]);
  const result = await checkHealth('http://127.0.0.1:1', { fetchImpl, attempts: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'down');
  assert.equal(calls.length, 2);
});
