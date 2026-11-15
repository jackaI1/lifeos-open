// Runs the exported workflow's Code node text in-process, with n8n's inputs faked.
// This checks the same code n8n runs, without needing Docker.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {buildWorkflow} from '../integrations/n8n/build-workflow.mjs';
import {signBody} from '../integrations/n8n/lib/webhook-guard.mjs';

const AsyncFunction = (async () => {}).constructor;
const SECRET = 'fictional-test-secret-with-enough-length';
const TOKEN = 'fictional-notify-token-0123456789';
const URL_NOTIFY = 'http://sink.test/notify';
const event = {type: 'deadline.due-soon', id: 'deadline-outline', title: 'Map the feedback loop', dueAt: new Date(Date.now() + 3600e3).toISOString()};

async function deliver({rawBody, headers, statuses = [200], state = {}}) {
  const workflow = await buildWorkflow();
  const code = workflow.nodes.find(node => node.name === 'Verify, dedupe, remind').parameters.jsCode;
  const run = new AsyncFunction('$input', '$env', '$getWorkflowStaticData', code);
  const calls = [];
  const context = {helpers: {httpRequest: async options => {
    calls.push(options);
    return {statusCode: statuses.length > 1 ? statuses.shift() : statuses[0]};
  }}};
  const input = {first: () => ({json: {headers}, binary: rawBody === null ? undefined : {data: {data: Buffer.from(rawBody).toString('base64')}}})};
  const env = {LIFEOS_WEBHOOK_SECRET: SECRET, LIFEOS_NOTIFY_URL: URL_NOTIFY, LIFEOS_NOTIFY_TOKEN: TOKEN};
  const [{json}] = await run.call(context, input, env, () => state);
  return {result: json, calls, state};
}

async function signedHeaders(raw, secret = SECRET) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {'x-lifeos-timestamp': timestamp, 'x-lifeos-signature': await signBody(webcrypto.subtle, secret, timestamp, raw)};
}

test('the committed workflow JSON is the build output', async () => {
  const committed = JSON.parse(await readFile(new URL('../integrations/n8n/workflows/deadline-reminders.json', import.meta.url), 'utf8'));
  assert.deepEqual(committed, JSON.parse(JSON.stringify(await buildWorkflow())));
});

test('the Code node carries the guard source with no export keywords left', async () => {
  const workflow = await buildWorkflow();
  const code = workflow.nodes.find(node => node.name === 'Verify, dedupe, remind').parameters.jsCode;
  assert.doesNotMatch(code, /^export /m);
  assert.match(code, /async function verifyDelivery/);
  assert.equal(workflow.nodes[0].parameters.options.rawBody, true, 'the webhook keeps the raw bytes that were signed');
});

test('a signed event is delivered and logged', async () => {
  const raw = JSON.stringify(event);
  const {result, calls, state} = await deliver({rawBody: raw, headers: await signedHeaders(raw)});
  assert.equal(result.status, 202);
  assert.equal(result.outcome, 'delivered');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, URL_NOTIFY);
  assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].body.eventId, 'deadline-outline');
  assert.equal(state.log.length, 1);
  assert.equal(state.log[0].outcome, 'delivered');
});

test('a replay is refused and does not send a second reminder', async () => {
  const raw = JSON.stringify(event);
  const state = {};
  await deliver({rawBody: raw, headers: await signedHeaders(raw), state});
  const again = await deliver({rawBody: raw, headers: await signedHeaders(raw), state});
  assert.equal(again.result.status, 409);
  assert.equal(again.calls.length, 0);
  assert.equal(state.log.at(-1).outcome, 'rejected');
});

test('a bad signature is refused with 401 and nothing is sent', async () => {
  const raw = JSON.stringify(event);
  const {result, calls} = await deliver({rawBody: raw, headers: await signedHeaders(raw, 'wrong-secret-that-is-long-enough')});
  assert.equal(result.status, 401);
  assert.equal(calls.length, 0);
});

test('a request without a raw body is refused', async () => {
  const {result} = await deliver({rawBody: null, headers: {}});
  assert.equal(result.status, 400);
});

test('a reminder that fails twice is retried and then delivered', async () => {
  const raw = JSON.stringify(event);
  const {result, calls} = await deliver({rawBody: raw, headers: await signedHeaders(raw), statuses: [503, 503, 200]});
  assert.equal(result.status, 202);
  assert.equal(result.attempts, 3);
  assert.equal(calls.length, 3);
});

test('a reminder that keeps failing is reported as failed after four attempts', async () => {
  const raw = JSON.stringify(event);
  const {result, calls} = await deliver({rawBody: raw, headers: await signedHeaders(raw), statuses: [503]});
  assert.equal(result.status, 502);
  assert.equal(result.outcome, 'failed');
  assert.equal(calls.length, 4);
});
