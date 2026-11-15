// Sends signed reminder events for deadlines due within 24 hours. It reads one workspace file
// read-only and posts each event to the n8n webhook. A 409 means that reminder was already sent.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {dueSoonEvents, signedHeaders} from './lib/sign.mjs';

export async function sendDueSoon({tasks, url, secret, nowMs = Date.now(), fetchImpl = fetch}) {
  const results = [];
  for (const event of dueSoonEvents(tasks, nowMs)) {
    const response = await fetchImpl(url, {method: 'POST', headers: signedHeaders(secret, event, nowMs), body: JSON.stringify(event), signal: AbortSignal.timeout(10_000)});
    results.push({id: event.id, status: response.status});
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const secret = process.env.WEBHOOK_SIGNING_SECRET;
  const url = process.env.REMINDER_WEBHOOK_URL ?? 'http://127.0.0.1:5678/webhook/deadline-events';
  const file = process.env.LIFEOS_DATABASE;
  if (!secret || secret.length < 24) throw Error('Set WEBHOOK_SIGNING_SECRET to at least 24 characters.');
  if (!file) throw Error('Set LIFEOS_DATABASE to the workspace file to read.');
  const {LocalDatabase} = await import('../../src/local/database.ts');
  const db = new LocalDatabase(file, {readOnly: true});
  try {
    const rows = await db.prepare("SELECT data FROM records WHERE kind='task'").all();
    const tasks = rows.results.map(row => JSON.parse(String(row.data)));
    const results = await sendDueSoon({tasks, url, secret});
    console.log(JSON.stringify({sent: results.length, results}));
  } finally {
    db.db.close();
  }
}
