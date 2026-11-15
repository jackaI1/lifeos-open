// Runs against a real n8n container started by CI (compose.yaml), with the reminder sink started
// with FAIL_FIRST=2. Skipped unless N8N_URL, SINK_URL and WEBHOOK_SIGNING_SECRET are set.
import test from 'node:test';
import assert from 'node:assert/strict';
import {signedHeaders} from '../lib/sign.mjs';

const {N8N_URL, SINK_URL, WEBHOOK_SIGNING_SECRET} = process.env;
const enabled = Boolean(N8N_URL && SINK_URL && WEBHOOK_SIGNING_SECRET);
const event = (id, overrides = {}) => ({
  id, type: 'deadline.due_soon', occurredAt: new Date().toISOString(),
  dueAt: new Date(Date.now() + 3_600_000).toISOString(), title: 'Live fictional essay', ...overrides,
});
const send = (body, headers) => fetch(`${N8N_URL}/webhook/deadline-events`, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)});

test('n8n retries a failing reminder, delivers it and reports the attempts', {skip: !enabled && 'set N8N_URL, SINK_URL and WEBHOOK_SIGNING_SECRET', timeout: 120000}, async () => {
  const body = event('live-retry');
  const response = await send(body, signedHeaders(WEBHOOK_SIGNING_SECRET, body));
  assert.equal(response.status, 202);
  const result = await response.json();
  assert.equal(result.delivered, true);
  assert.equal(result.attempts.length, 3);
  const stats = await (await fetch(`${SINK_URL}/stats`)).json();
  assert.ok(stats.items.some(item => item.id === 'reminder-live-retry'));
});

test('a replayed signed event is refused with 409 and not delivered twice', {skip: !enabled && 'set N8N_URL', timeout: 60000}, async () => {
  const body = event('live-replay');
  const headers = signedHeaders(WEBHOOK_SIGNING_SECRET, body);
  assert.equal((await send(body, headers)).status, 202);
  assert.equal((await send(body, headers)).status, 409);
  const stats = await (await fetch(`${SINK_URL}/stats`)).json();
  assert.equal(stats.items.filter(item => item.id === 'reminder-live-replay').length, 1);
});

test('a bad signature gets 401, a stale one 401, and a malformed event 400', {skip: !enabled && 'set N8N_URL', timeout: 60000}, async () => {
  const body = event('live-forged');
  assert.equal((await send(body, signedHeaders('wrong-secret-that-is-long-enough-1', body))).status, 401);
  const stale = signedHeaders(WEBHOOK_SIGNING_SECRET, body, Date.now() - 3_600_000);
  assert.equal((await send(body, stale)).status, 401);
  const malformed = event('live-malformed', {title: 'two\nlines'});
  assert.equal((await send(malformed, signedHeaders(WEBHOOK_SIGNING_SECRET, malformed))).status, 400);
  const stats = await (await fetch(`${SINK_URL}/stats`)).json();
  assert.ok(!stats.items.some(item => item.id.startsWith('reminder-live-forged') || item.id.startsWith('reminder-live-malformed')));
});
