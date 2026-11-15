import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {dueSoonEvents, signEvent, signedHeaders, canonicalString} from '../integrations/deadline-reminders/lib/sign.mjs';
import {sendDueSoon} from '../integrations/deadline-reminders/sender.mjs';

const require = createRequire(import.meta.url);
const workflow = JSON.parse(await readFile(new URL('../integrations/deadline-reminders/workflows/deadline-reminders.json', import.meta.url), 'utf8'));
const code = name => workflow.nodes.find(node => node.name === name).parameters.jsCode;
const SECRET = 'fictional-reminder-secret-0123456789';
const VERIFY = 'Verify signature and replay';
const DELIVER = 'Deliver reminder with retries';

/** Run one n8n Code node body the same way n8n wraps it: an async function with $input, $env and a helper. */
async function runNode(name, {input, env = {}, store = {}, httpRequest, delays = []}) {
  const sandbox = {
    $input: {first: () => ({json: input})},
    $env: {WEBHOOK_SIGNING_SECRET: SECRET, REMINDER_URL: 'http://sink.invalid/notify', REMINDER_RETRY_BASE_MS: '1000', ...env},
    $getWorkflowStaticData: () => store,
    crypto: webcrypto, TextEncoder, require, console,
    setTimeout: (resolve, ms) => { delays.push(ms); resolve(); },
  };
  const run = runInNewContext(`(async function(){${code(name)}\n})`, sandbox);
  return (await run.call({helpers: {httpRequest: httpRequest ?? (async () => ({}))}}))[0].json;
}

const soon = (overrides = {}) => ({
  id: 'deadline:essay:2026-11-16T20:00:00.000Z', type: 'deadline.due_soon',
  occurredAt: new Date().toISOString(), dueAt: new Date(Date.now() + 3_600_000).toISOString(),
  title: 'Essay draft', ...overrides,
});
const request = (event, {secret = SECRET, at = Date.now(), body = event, signature} = {}) => {
  const headers = signedHeaders(secret, event, at);
  if (signature !== undefined) headers['x-lifeos-signature'] = signature;
  return {headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, v])), body};
};

test('a correctly signed deadline event is accepted once, and its replay is refused', async () => {
  const store = {};
  const event = soon();
  const first = await runNode(VERIFY, {input: request(event), store});
  assert.equal(first.accepted, true);
  assert.equal(first.status, 202);
  const replay = await runNode(VERIFY, {input: request(event), store});
  assert.equal(replay.status, 409);
  assert.equal(replay.body.error, 'replayed_event');
});

test('wrong secret, tampered title and stale timestamps are rejected with 401', async () => {
  const event = soon();
  assert.equal((await runNode(VERIFY, {input: request(event, {secret: 'another-secret-that-is-long-enough'})})).body.error, 'bad_signature');
  const tampered = request(event);
  tampered.body = {...event, title: 'Changed after signing'};
  assert.equal((await runNode(VERIFY, {input: tampered})).body.error, 'bad_signature');
  assert.equal((await runNode(VERIFY, {input: request(event, {at: Date.now() - 10 * 60_000})})).body.error, 'stale_timestamp');
  const badClock = request(event);
  badClock.headers['x-lifeos-timestamp'] = 'yesterday';
  assert.equal((await runNode(VERIFY, {input: badClock})).body.error, 'bad_timestamp');
});

test('malformed events are rejected with 400 before any signature check', async () => {
  const event = soon();
  const cases = [
    {...event, id: undefined},
    {...event, type: 'order.created'},
    {...event, occurredAt: 'not a time'},
    {...event, title: 'line one\nline two'},
    {...event, dueAt: 'tomorrow'},
  ];
  for (const bad of cases) {
    const result = await runNode(VERIFY, {input: {headers: {}, body: bad}});
    assert.equal(result.status, 400, JSON.stringify(bad));
    assert.equal(result.body.error, 'malformed_event');
  }
});

test('a failing delivery is retried with doubling delays and then succeeds', async () => {
  const delays = [];
  const calls = [];
  const httpRequest = async options => {
    calls.push(options.body);
    if (calls.length < 3) throw Object.assign(new Error('sink unavailable'), {statusCode: 503});
    return {};
  };
  const store = {};
  const result = await runNode(DELIVER, {input: {event: soon()}, httpRequest, delays, store});
  assert.equal(result.status, 202);
  assert.equal(result.body.delivered, true);
  assert.equal(result.body.attempts.length, 3);
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(calls[0].route, 'reminders');
  assert.equal(calls[0].title, 'Essay draft');
  assert.equal(store.log.at(-1).delivered, true);
});

test('a delivery that keeps failing stops after four attempts, logs the failure and reports 502', async () => {
  const delays = [];
  const store = {};
  const result = await runNode(DELIVER, {
    input: {event: soon()}, store, delays,
    httpRequest: async () => { throw Object.assign(new Error('timeout'), {}); },
  });
  assert.equal(result.status, 502);
  assert.equal(result.body.delivered, false);
  assert.equal(result.body.attempts.length, 4);
  assert.deepEqual(delays, [1000, 2000, 4000]);
  assert.equal(store.log.at(-1).delivered, false);
});

test('the sender and the workflow agree on the signed bytes', async () => {
  const now = Date.now();
  const tasks = [
    {id: 'essay', title: 'Essay draft', dueAt: new Date(now + 2 * 3600_000).toISOString(), status: 'todo'},
    {id: 'far', title: 'Final project', dueAt: new Date(now + 3 * 86400_000).toISOString(), status: 'todo'},
  ];
  const sent = [];
  const results = await sendDueSoon({tasks, url: 'http://n8n.invalid/webhook/deadline-events', secret: SECRET, nowMs: now,
    fetchImpl: async (url, init) => { sent.push({url, init}); return new Response('{}', {status: 202}); }});
  assert.deepEqual(results.map(r => r.status), [202]);
  const event = JSON.parse(sent[0].init.body);
  const headers = sent[0].init.headers;
  assert.equal(headers['x-lifeos-signature'], signEvent(SECRET, headers['x-lifeos-timestamp'], event));
  const verified = await runNode(VERIFY, {input: {headers, body: event}, store: {}});
  assert.equal(verified.status, 202);
  assert.match(canonicalString({timestamp: '1', event: {id: 'a', type: 'calendar.changed', occurredAt: 'b', title: 'c'}}), /\n/);
});

test('only open deadlines due within 24 hours become reminders', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const at = ms => new Date(now + ms).toISOString();
  const tasks = [
    {id: 'soon', title: 'Soon', dueAt: at(2 * 3600_000), status: 'todo'},
    {id: 'later', title: 'Later', dueAt: at(3 * 86400_000), status: 'todo'},
    {id: 'past', title: 'Past', dueAt: at(-3600_000), status: 'todo'},
    {id: 'done', title: 'Done', dueAt: at(3600_000), status: 'complete'},
    {id: 'archived', title: 'Archived', dueAt: at(3600_000), archived: true},
    {id: 'undated', title: 'Undated', dueDate: '2026-11-16', status: 'todo'},
    {id: 'newline', title: 'Two\nlines', dueAt: at(60_000), status: 'todo'},
  ];
  const events = dueSoonEvents(tasks, now);
  assert.deepEqual(events.map(e => e.title), ['Soon', 'Two lines']);
  assert.equal(events[0].id, `deadline:soon:${at(2 * 3600_000)}`);
});

test('the workflow is a webhook, a verifier, a branch, a retrying delivery and a response, with no secret inside', async () => {
  assert.equal(workflow.nodes.find(n => n.type === 'n8n-nodes-base.webhook').parameters.path, 'deadline-events');
  assert.equal(workflow.nodes.find(n => n.type === 'n8n-nodes-base.webhook').parameters.responseMode, 'responseNode');
  assert.ok(workflow.nodes.some(n => n.type === 'n8n-nodes-base.respondToWebhook'));
  assert.equal(workflow.active, false);
  const raw = await readFile(new URL('../integrations/deadline-reminders/workflows/deadline-reminders.json', import.meta.url), 'utf8');
  assert.ok(!raw.includes(SECRET));
  assert.doesNotMatch(raw, /sk_live|api[_-]?key/i);
});
