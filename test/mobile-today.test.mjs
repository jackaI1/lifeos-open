import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deadlineDay, parseFeed, resolveDemoFeed, selectToday} from '../src/shared/today.ts';

const fixture = () => ({schemaVersion: 1, fictional: true, anchorDate: '2026-10-06', timeZone: 'America/Toronto',
  events: [{id: 'lab', title: 'Systems lab', start: '2026-10-06T14:00:00Z', end: '2026-10-06T15:00:00Z', location: 'Room S-204'}],
  tasks: [{id: 'prelab', title: 'Pre-lab', dueDate: '2026-10-06'}, {id: 'report', title: 'Report', dueAt: '2026-10-07T02:00:00Z'}, {id: 'unknown', title: 'Reflection'}]});

test('deadline dates agree with the web: offsets, date-only, unknown and invalid', () => {
  assert.equal(deadlineDay({dueAt: '2026-11-06T02:00:00Z'}, 'America/Toronto'), '2026-11-05');
  assert.equal(deadlineDay({dueDate: '2026-11-05'}, 'America/Toronto'), '2026-11-05');
  assert.equal(deadlineDay({dueDate: '2026-02-30'}, 'America/Toronto'), null);
  assert.equal(deadlineDay({}, 'America/Toronto'), null);
  assert.equal(deadlineDay({dueAt: 'bad', dueDate: '2026-11-05'}, 'America/Toronto'), null);
});

test('fresh samples keep Toronto wall time across DST; saved snapshots do not move', () => {
  const resolved = resolveDemoFeed(parseFeed(fixture()), Date.parse('2026-11-05T16:00:00Z'));
  assert.equal(resolved.anchorDate, '2026-11-05');
  assert.equal(resolved.events[0].start, '2026-11-05T15:00:00.000Z');
  assert.equal(resolved.tasks[1].dueAt, '2026-11-06T03:00:00.000Z');
  assert.equal(selectToday(resolved, Date.parse('2026-11-05T16:00:00Z')).events.length, 1);
  const tomorrow = selectToday(resolved, Date.parse('2026-11-06T16:00:00Z'));
  assert.equal(tomorrow.events.length, 0);
  assert.equal(tomorrow.deadlines[0].day, '2026-11-05');
});

test('LifeOS switches days at 5am, includes overnight events and end is exclusive', () => {
  const feed = fixture();
  feed.events.push({id: 'night', title: 'Late study', start: '2026-10-07T03:00:00Z', end: '2026-10-07T05:00:00Z'});
  feed.events.push({id: 'ended', title: 'Ended', start: '2026-10-06T08:00:00Z', end: '2026-10-06T09:00:00Z'});
  assert.equal(selectToday(feed, Date.parse('2026-10-07T08:59:00Z')).day, '2026-10-06');
  assert.deepEqual(selectToday(feed, Date.parse('2026-10-07T08:59:00Z')).events.map(e => e.id), ['lab', 'night']);
  assert.equal(selectToday(feed, Date.parse('2026-10-07T09:00:00Z')).day, '2026-10-07');
});

test('deadlines retain unknowns, omit completed work and limit upcoming work to seven days', () => {
  const feed = fixture();
  feed.tasks.push({id: 'done', title: 'Done', dueDate: '2026-10-06', status: 'completed'}, {id: 'later', title: 'Later', dueDate: '2026-10-14'});
  const today = selectToday(feed, Date.parse('2026-10-06T16:00:00Z'));
  assert.deepEqual(today.deadlines.map(t => t.id), ['prelab', 'report']);
  assert.equal(today.unknown[0].title, 'Reflection');
});

test('reject unsupported, non-fictional, malformed and duplicate feed records', () => {
  for (const value of [null, {}, {...fixture(), fictional: false}, {...fixture(), schemaVersion: 2}, {...fixture(), timeZone: 'bad'}, {...fixture(), anchorDate: '2026-02-30'}, {...fixture(), events: [{id: 'x', title: 'x', start: 'bad', end: 'bad'}]}, {...fixture(), tasks: [{id: 'x', title: 'x', dueDate: 'bad'}]}]) assert.throws(() => parseFeed(value));
  const duplicate = fixture(); duplicate.tasks.push(duplicate.tasks[0]);
  assert.throws(() => parseFeed(duplicate));
});

test('committed feed is valid and contains actual public demo examples', async () => {
  const feed = parseFeed(JSON.parse(await readFile('public/demo/today.json', 'utf8')));
  assert.ok(feed.tasks.some(t => t.title === 'Map the feedback loop'));
  assert.ok(feed.events.some(e => e.title === 'Workshop'));
});
