import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {webcrypto} from 'node:crypto';
import {dueSoonEvents, calendarChangeEvents, signRequest, run} from '../integrations/n8n/send.mjs';
import {signBody, verifyDelivery, createSeenStore} from '../integrations/n8n/lib/webhook-guard.mjs';

const SECRET = 'fictional-test-secret-with-enough-length';
const NOW = Date.parse('2026-10-06T16:00:00Z');
const H = 3600e3;

test('only open deadlines due within 24 hours become due-soon events', () => {
  const feed = {tasks: [
    {id: 'soon', title: 'Soon', dueAt: new Date(NOW + 2 * H).toISOString(), status: 'todo'},
    {id: 'later', title: 'Later', dueAt: new Date(NOW + 30 * H).toISOString(), status: 'todo'},
    {id: 'done', title: 'Done', dueAt: new Date(NOW + 2 * H).toISOString(), status: 'complete'},
    {id: 'archived', title: 'Archived', dueAt: new Date(NOW + 2 * H).toISOString(), archived: true},
    {id: 'dateonly', title: 'Date only', dueDate: '2026-10-06'},
  ]};
  const events = dueSoonEvents(feed, NOW);
  assert.deepEqual(events.map(event => event.id), ['deadline-soon']);
  assert.equal(events[0].type, 'deadline.due-soon');
});

test('calendar changes: the first run only records a baseline, later runs report changes', () => {
  const first = calendarChangeEvents([{id: 'a', title: 'Lab', start: 's1', end: 'e1'}], {});
  assert.equal(first.changes.length, 0);
  const same = calendarChangeEvents([{id: 'a', title: 'Lab', start: 's1', end: 'e1'}], first.next);
  assert.equal(same.changes.length, 0);
  const moved = calendarChangeEvents([{id: 'a', title: 'Lab', start: 's2', end: 'e2'}], first.next);
  assert.equal(moved.changes.length, 1);
  assert.equal(moved.changes[0].type, 'calendar.changed');
  assert.match(moved.changes[0].id, /^calendar-a-[0-9a-f]{12}$/);
});

test('the sender signature is the one the guard checks', async () => {
  const timestamp = '1790000000';
  const body = '{"type":"calendar.changed","id":"x"}';
  assert.equal(signRequest(SECRET, timestamp, body), await signBody(webcrypto.subtle, SECRET, timestamp, body));
});

test('run() posts each event with a signature the server accepts, and saves the calendar state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lifeos-n8n-'));
  const statePath = join(dir, 'state.json');
  try {
    const posted = [];
    const fetchImpl = async (url, init) => {
      posted.push({url, init});
      return {status: 202};
    };
    // First run: calendar baseline only. Due-soon events depend on the demo feed's dates.
    const first = await run({url: 'http://n8n.test/webhook/x', secret: SECRET, statePath, now: NOW, fetchImpl});
    for (const {init} of posted) {
      const headers = init.headers;
      const verdict = await verifyDelivery({
        subtle: webcrypto.subtle, secret: SECRET, headers, rawBody: init.body, now: Number(headers['x-lifeos-timestamp']) * 1000,
        seen: createSeenStore({}),
      });
      assert.equal(verdict.ok, true, verdict.reason);
    }
    assert.equal(first.length, posted.length);
    const saved = JSON.parse(await readFile(statePath, 'utf8'));
    assert.ok(saved.calendar && typeof saved.calendar === 'object');
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
