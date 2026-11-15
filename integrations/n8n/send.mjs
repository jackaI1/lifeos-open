// Sender for the planner's events. It finds deadlines due within 24 hours and calendar
// items that changed since the last run, signs each event and posts it to the n8n webhook.
//   LIFEOS_WEBHOOK_SECRET=... node integrations/n8n/send.mjs --url http://127.0.0.1:5678/webhook/lifeos/deadlines
import {createHash, createHmac} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadPlannerData} from '../../src/mcp/planner/server.mjs';
import {resolveDemoFeed} from '../../src/shared/today.ts';

const DONE = new Set(['complete', 'completed', 'submitted', 'cancelled', 'archived']);
const DAY_MS = 24 * 60 * 60 * 1000;

export function signRequest(secret, timestamp, rawBody) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

/** Deadlines due within the next 24 hours. Date-only deadlines are skipped: they have no time to count from. */
export function dueSoonEvents(feed, now) {
  return feed.tasks
    .filter(task => task.dueAt && !task.archived && !DONE.has(task.status ?? ''))
    .filter(task => Date.parse(task.dueAt) >= now && Date.parse(task.dueAt) - now <= DAY_MS)
    .map(task => ({type: 'deadline.due-soon', id: `deadline-${task.id}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 80), title: task.title, dueAt: task.dueAt}));
}

const fingerprint = event => createHash('sha256').update(JSON.stringify([event.id, event.title, event.start, event.end, event.location ?? ''])).digest('hex');

/** Calendar items are new or changed when their fingerprint differs from the saved state. */
export function calendarChangeEvents(events, previous = {}) {
  const next = {};
  const changes = [];
  for (const event of events) {
    const hash = fingerprint(event);
    next[event.id] = hash;
    if (previous[event.id] !== undefined && previous[event.id] === hash) continue;
    if (previous[event.id] === undefined && Object.keys(previous).length === 0) continue; // first run only records the baseline
    changes.push({type: 'calendar.changed', id: `calendar-${event.id}-${hash.slice(0, 12)}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 80), title: event.title, dueAt: event.start, changedFields: ['time']});
  }
  return {changes, next};
}

export async function run({url, secret, statePath, now = Date.now(), fetchImpl = fetch}) {
  const data = await loadPlannerData();
  const feed = resolveDemoFeed(data.feed, now);
  const previous = await readFile(statePath, 'utf8').then(JSON.parse, () => ({}));
  const calendar = calendarChangeEvents(feed.events, previous.calendar ?? {});
  const events = [...dueSoonEvents(feed, now), ...calendar.changes];
  const results = [];
  for (const event of events) {
    const body = JSON.stringify(event);
    const timestamp = String(Math.floor(now / 1000));
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-lifeos-timestamp': timestamp, 'x-lifeos-signature': signRequest(secret, timestamp, body)},
      body,
    });
    results.push({id: event.id, status: response.status});
  }
  await mkdir(dirname(statePath), {recursive: true});
  await writeFile(statePath, JSON.stringify({calendar: calendar.next}, null, 2));
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[process.argv.indexOf('--url') + 1];
  const secret = process.env.LIFEOS_WEBHOOK_SECRET;
  if (!url || !secret) throw new Error('Pass --url and set LIFEOS_WEBHOOK_SECRET');
  const statePath = process.env.LIFEOS_N8N_STATE ?? '.lifeos/n8n-state.json';
  const results = await run({url, secret, statePath});
  console.log(JSON.stringify(results));
}
