// Needs the Compose stack from integrations/n8n/compose.yaml. Skipped unless
// LIFEOS_N8N_URL is set (CI sets it after `docker compose up`).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {signBody} from '../integrations/n8n/lib/webhook-guard.mjs';

const webhook = process.env.LIFEOS_N8N_URL;
const secret = process.env.LIFEOS_WEBHOOK_SECRET;
const sink = process.env.LIFEOS_SINK_URL ?? 'http://127.0.0.1:8080';

async function post(body, {secret: key = secret, timestamp = String(Math.floor(Date.now() / 1000))} = {}) {
  const signature = await signBody(webcrypto.subtle, key, timestamp, body);
  const response = await fetch(webhook, {method: 'POST', headers: {'content-type': 'application/json', 'x-lifeos-timestamp': timestamp, 'x-lifeos-signature': signature}, body});
  return response.status;
}

test('n8n accepts a signed reminder, refuses its replay and a forged one, and delivers to the sink',
  {skip: !webhook || !secret, timeout: 120_000}, async () => {
    const id = `deadline-ci-${Date.now()}`;
    const body = JSON.stringify({type: 'deadline.due-soon', id, title: 'CI check reminder', dueAt: new Date(Date.now() + 3600e3).toISOString()});
    assert.equal(await post(body), 202);
    assert.equal(await post(body), 409);
    assert.equal(await post(body, {secret: 'forged-secret-that-is-long-enough-0'}), 401);
    const deliveries = await (await fetch(`${sink}/deliveries`)).json();
    assert.ok(deliveries.some(entry => entry.eventId === id), 'the sink received the reminder');
  });
