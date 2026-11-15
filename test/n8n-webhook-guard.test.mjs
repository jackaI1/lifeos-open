import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {verifyDelivery, signBody, createSeenStore, parseEvent, deliverWithRetry, buildReminder, GUARD_LIMITS} from '../integrations/n8n/lib/webhook-guard.mjs';

const {subtle} = webcrypto;
const SECRET = 'fictional-test-secret-with-enough-length';
const NOW = Date.parse('2026-10-06T16:00:00Z');
const TS = String(Math.floor(NOW / 1000));
const event = {type: 'deadline.due-soon', id: 'deadline-outline-1', title: 'Map the feedback loop', dueAt: '2026-10-07T12:00:00Z'};
const body = JSON.stringify(event);

async function signed(overrides = {}) {
  const timestamp = overrides.timestamp ?? TS;
  const raw = overrides.body ?? body;
  return {
    'x-lifeos-timestamp': timestamp,
    'x-lifeos-signature': overrides.signature ?? await signBody(subtle, overrides.secret ?? SECRET, timestamp, raw),
  };
}
const check = async (overrides = {}, seen = createSeenStore({})) => verifyDelivery({
  subtle, secret: overrides.secret === undefined ? SECRET : overrides.secret,
  headers: overrides.headers ?? await signed(overrides), rawBody: overrides.body ?? body, now: NOW, seen,
});

test('a correctly signed event is accepted with 202', async () => {
  const result = await check();
  assert.equal(result.ok, true);
  assert.equal(result.status, 202);
  assert.equal(result.event.id, 'deadline-outline-1');
});

test('a wrong secret, a tampered body or a changed timestamp fails the signature check with 401', async () => {
  const forged = await verifyDelivery({subtle, secret: SECRET, headers: await signed({secret: 'another-secret-that-is-long-enough'}), rawBody: body, now: NOW, seen: createSeenStore({})});
  assert.equal(forged.status, 401, 'signed with the wrong key, so refused by the server\'s key');
  const headers = await signed();
  const tampered = await verifyDelivery({subtle, secret: SECRET, headers, rawBody: body.replace('Map', 'Mop'), now: NOW, seen: createSeenStore({})});
  assert.equal(tampered.status, 401);
  assert.match(tampered.reason, /Signature/);
  const moved = await verifyDelivery({subtle, secret: SECRET, headers: {...headers, 'x-lifeos-timestamp': String(Number(TS) + 1)}, rawBody: body, now: NOW, seen: createSeenStore({})});
  assert.equal(moved.status, 401);
});

test('missing or malformed headers are refused before anything else is read', async () => {
  const none = await verifyDelivery({subtle, secret: SECRET, headers: {}, rawBody: body, now: NOW, seen: createSeenStore({})});
  assert.equal(none.status, 401);
  const badTime = await check({headers: {'x-lifeos-timestamp': 'yesterday', 'x-lifeos-signature': 'sha256=00'}});
  assert.equal(badTime.status, 401);
});

test('a timestamp outside the five-minute window is refused even with a valid signature', async () => {
  const old = String(Number(TS) - GUARD_LIMITS.toleranceSeconds - 1);
  const result = await check({timestamp: old});
  assert.equal(result.status, 401);
  assert.match(result.reason, /five-minute/);
  const edge = String(Number(TS) - GUARD_LIMITS.toleranceSeconds);
  assert.equal((await check({timestamp: edge})).ok, true);
});

test('a replayed event id is refused with 409 for 24 hours', async () => {
  const seen = createSeenStore({});
  const first = await check({}, seen);
  assert.equal(first.ok, true);
  seen.add(first.event.id, NOW);
  const replay = await check({}, seen);
  assert.equal(replay.status, 409);
  const later = verifyDelivery({subtle, secret: SECRET, headers: await signed(), rawBody: body, now: NOW + GUARD_LIMITS.replayWindowMs + 1000, seen});
  assert.equal((await later).status, 401, 'an old signature is refused by the timestamp window instead');
});

test('the replay store forgets an id once its window has passed', () => {
  const state = {};
  const seen = createSeenStore(state);
  seen.add('a', NOW);
  assert.equal(seen.has('a', NOW + 1), true);
  assert.equal(seen.has('a', NOW + GUARD_LIMITS.replayWindowMs), false);
  assert.equal(state.a, undefined, 'expired entries are removed from the saved state');
});

test('malformed but correctly signed bodies are refused with a reason', () => {
  assert.equal(parseEvent('not json', NOW).status, 400);
  assert.equal(parseEvent('[]', NOW).status, 422);
  assert.equal(parseEvent(JSON.stringify({...event, type: 'payment.sent'}), NOW).status, 422);
  assert.equal(parseEvent(JSON.stringify({...event, id: 'has spaces'}), NOW).status, 422);
  assert.equal(parseEvent(JSON.stringify({...event, title: ''}), NOW).status, 422);
  assert.equal(parseEvent(JSON.stringify({...event, title: 'x'.repeat(201)}), NOW).status, 422);
  assert.equal(parseEvent(JSON.stringify({...event, dueAt: 'soon'}), NOW).status, 422);
  assert.equal(parseEvent(JSON.stringify({...event, changedFields: 'time'}), NOW).status, 422);
});

test('a due-soon event must be within 24 hours of now', () => {
  const far = {...event, dueAt: '2026-10-09T12:00:00Z'};
  const result = parseEvent(JSON.stringify(far), NOW);
  assert.equal(result.status, 422);
  assert.match(result.reason, /24 hours/);
  assert.equal(parseEvent(JSON.stringify({...far, type: 'calendar.changed'}), NOW).ok, true, 'calendar changes have no window');
});

test('a body over 8 KB is refused before it is parsed', async () => {
  const big = JSON.stringify({...event, title: 'x'.repeat(9000)});
  const result = await check({body: big, headers: await signed({body: big})});
  assert.equal(result.status, 413);
});

test('a reminder is delivered on the first try when the server accepts it', async () => {
  const sent = [];
  const result = await deliverWithRetry({send: async attempt => { sent.push(attempt); return 200; }, sleep: async () => {}});
  assert.deepEqual(result, {delivered: true, attempts: 1, status: 200});
  assert.deepEqual(sent, [1]);
});

test('transient failures are retried with growing delays, then delivered', async () => {
  const waits = [];
  const statuses = [503, 0, 200];
  const result = await deliverWithRetry({send: async () => statuses.shift(), sleep: async ms => waits.push(ms)});
  assert.equal(result.delivered, true);
  assert.equal(result.attempts, 3);
  assert.deepEqual(waits, [500, 1000]);
});

test('client errors are not retried, but rate limits are', async () => {
  const bad = await deliverWithRetry({send: async () => 400, sleep: async () => {}});
  assert.equal(bad.attempts, 1);
  assert.equal(bad.delivered, false);
  const limited = await deliverWithRetry({send: async () => 429, sleep: async () => {}});
  assert.equal(limited.attempts, GUARD_LIMITS.attempts);
});

test('after the last attempt the failure is reported with its reason', async () => {
  const waits = [];
  const result = await deliverWithRetry({send: async () => { throw new Error('offline'); }, sleep: async ms => waits.push(ms)});
  assert.deepEqual(result, {delivered: false, attempts: 4, reason: 'network error'});
  assert.deepEqual(waits, [500, 1000, 2000]);
});

test('the reminder carries the event id and a plain title', () => {
  assert.deepEqual(buildReminder(event), {type: 'lifeos.reminder', eventId: 'deadline-outline-1', title: 'Due soon: Map the feedback loop', dueAt: '2026-10-07T12:00:00Z'});
});
