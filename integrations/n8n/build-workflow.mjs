// Builds workflows/deadline-reminders.json from lib/webhook-guard.mjs. The Code node
// contains the guard's exact source, so the tests run the same text n8n runs.
//   node integrations/n8n/build-workflow.mjs           writes the file
//   node integrations/n8n/build-workflow.mjs --check   fails if the file is stale
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';

const GUARD = new URL('./lib/webhook-guard.mjs', import.meta.url);
const OUTPUT = new URL('./workflows/deadline-reminders.json', import.meta.url);

// Entry body for the n8n Code node. Runs once per webhook call with `this.helpers`.
export const ENTRY = `// Workflow entry: verify, deliver with retries, log the outcome.
// n8n Code nodes may not expose globalThis.crypto; NODE_FUNCTION_ALLOW_BUILTIN=crypto makes require() work.
const webcrypto = globalThis.crypto ?? require("crypto").webcrypto;
const item = $input.first();
const headers = item.json.headers ?? {};
const encoded = item.binary?.data?.data;
const rawBody = encoded ? new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))) : null;
const state = $getWorkflowStaticData('global');
state.seen = state.seen ?? {};
state.log = state.log ?? [];
const seen = createSeenStore(state.seen);
const now = Date.now();
const verdict = rawBody === null
  ? {ok: false, status: 400, reason: 'Raw body was not received'}
  : await verifyDelivery({subtle: webcrypto.subtle, secret: $env.LIFEOS_WEBHOOK_SECRET, headers, rawBody, now, seen});
let result;
if (!verdict.ok) {
  result = {status: verdict.status, outcome: 'rejected', reason: verdict.reason};
} else {
  seen.add(verdict.event.id, now);
  const reminder = buildReminder(verdict.event);
  const send = async () => {
    try {
      const response = await this.helpers.httpRequest({
        method: 'POST', url: $env.LIFEOS_NOTIFY_URL, body: reminder, json: true, timeout: 5000,
        headers: {authorization: 'Bearer ' + $env.LIFEOS_NOTIFY_TOKEN},
        ignoreHttpStatusErrors: true, returnFullResponse: true,
      });
      return response.statusCode;
    } catch (error) {
      return 0;
    }
  };
  const delivery = await deliverWithRetry({send, sleep: ms => new Promise(resolve => setTimeout(resolve, ms))});
  result = delivery.delivered
    ? {status: 202, outcome: 'delivered', attempts: delivery.attempts}
    : {status: 502, outcome: 'failed', attempts: delivery.attempts, reason: delivery.reason};
  result.eventId = verdict.event.id;
}
result.at = new Date(now).toISOString();
state.log = [...state.log, {at: result.at, eventId: result.eventId ?? null, outcome: result.outcome, status: result.status}].slice(-__LOG_LIMIT__);
return [{json: result}];`;

export async function buildWorkflow() {
  const source = (await readFile(GUARD, 'utf8')).replace(/^export /gm, '');
  if (/^import /m.test(source) || /^export \{/m.test(source)) throw new Error('The guard must not import or re-export anything');
  const limits = source.match(/logEntries: (\d+)/)?.[1] ?? '50';
  const entry = ENTRY.replace('__LOG_LIMIT__', limits);
  const jsCode = `${source}\n\n${entry}\n`;
  return {
    id: 'lifeos-deadline-reminders',
    name: 'LifeOS deadline reminders',
    active: false,
    nodes: [
      {id: 'webhook', name: 'Signed LifeOS event', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: '5f0c2c1e-8b8a-4d7e-9a57-1b1d2a3c4e5f',
        parameters: {httpMethod: 'POST', path: 'lifeos/deadlines', responseMode: 'responseNode', options: {rawBody: true}}},
      {id: 'verify', name: 'Verify, dedupe, remind', type: 'n8n-nodes-base.code', typeVersion: 2, position: [260, 0],
        parameters: {language: 'javaScript', jsCode}},
      {id: 'respond', name: 'Respond with outcome', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [520, 0],
        parameters: {respondWith: 'json', responseBody: '={{ $json }}', options: {responseCode: '={{ $json.status }}'}}},
    ],
    connections: {
      'Signed LifeOS event': {main: [[{node: 'Verify, dedupe, remind', type: 'main', index: 0}]]},
      'Verify, dedupe, remind': {main: [[{node: 'Respond with outcome', type: 'main', index: 0}]]},
    },
    settings: {executionOrder: 'v1', timezone: 'America/Toronto'},
    pinData: {},
    tags: [],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = JSON.stringify(await buildWorkflow(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const committed = await readFile(OUTPUT, 'utf8').catch(() => '');
    if (committed !== text) {
      console.error(`${fileURLToPath(OUTPUT)} is out of date. Run node integrations/n8n/build-workflow.mjs`);
      process.exit(1);
    }
    console.log('workflow JSON matches the guard source');
  } else {
    await writeFile(OUTPUT, text);
    console.log(`wrote ${fileURLToPath(OUTPUT)}`);
  }
}
