import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import {parsePlannerData, todaySchedule, unfinishedDeadlines, searchNotes, parseNotes, inputSchemas, LIMITS} from '../src/mcp/planner/tools.mjs';

// Fixed clock inside the fictional demo week (America/Toronto, 12:00 local on 2026-10-06).
const NOW = Date.parse('2026-10-06T16:00:00Z');
const data = parsePlannerData({
  feed: JSON.parse(await readFile(new URL('../public/demo/today.json', import.meta.url), 'utf8')),
  notes: JSON.parse(await readFile(new URL('../src/mcp/planner/fixtures/notes.json', import.meta.url), 'utf8')),
});

test('list_today_schedule returns only the events on the fictional day, in order', () => {
  const result = todaySchedule(data, NOW);
  assert.equal(result.day, '2026-10-06');
  assert.equal(result.timeZone, 'America/Toronto');
  assert.deepEqual(result.events.map(event => event.title), ['Workshop', 'Study group', 'Office hours']);
  assert.equal(result.truncated, false);
  assert.ok(result.events.every(event => event.start < event.end));
});

test('list_today_schedule is bounded when there are too many events', () => {
  const many = {...data, feed: {...data.feed, events: Array.from({length: LIMITS.events + 3}, (_, i) => ({
    id: `e${i}`, title: `Block ${i}`, start: `2026-10-06T1${i % 5}:00:00Z`, end: `2026-10-06T1${i % 5}:30:00Z`,
  }))}};
  const result = todaySchedule(many, NOW);
  assert.equal(result.events.length, LIMITS.events);
  assert.equal(result.truncated, true);
});

test('list_unfinished_deadlines includes open dated tasks sorted by day and counts undated ones', () => {
  const result = unfinishedDeadlines(data, NOW, {withinDays: 14});
  assert.equal(result.today, '2026-10-06');
  const days = result.deadlines.map(task => task.day);
  assert.deepEqual(days, [...days].sort());
  assert.ok(result.deadlines.every(task => task.status === 'todo'));
  assert.equal(result.withoutDate, 1, 'the demo task with no date is counted, not guessed');
});

test('list_unfinished_deadlines respects the window and marks overdue work', () => {
  const short = unfinishedDeadlines(data, NOW, {withinDays: 1});
  assert.ok(short.deadlines.every(task => task.day <= '2026-10-07'));
  // The demo moves with today, so overdue work needs a task dated before the feed anchor.
  const late = {...data, feed: {...data.feed, tasks: [{id: 'late', title: 'Late task', dueDate: '2026-10-05', status: 'todo'}]}};
  const [task] = unfinishedDeadlines(late, NOW, {withinDays: 1}).deadlines;
  assert.equal(task.overdue, true);
  assert.equal(task.day, '2026-10-05');
});

test('completed and archived tasks never appear as unfinished', () => {
  const closed = {...data, feed: {...data.feed, tasks: [
    {id: 'done', title: 'Done task', dueDate: '2026-10-07', status: 'complete'},
    {id: 'gone', title: 'Archived task', dueDate: '2026-10-07', status: 'todo', archived: true},
    {id: 'open', title: 'Open task', dueDate: '2026-10-07', status: 'todo'},
  ]}};
  assert.deepEqual(unfinishedDeadlines(closed, NOW).deadlines.map(task => task.id), ['open']);
});

test('search_notes ranks matches and returns short snippets for every query word', () => {
  const result = searchNotes(data, {query: 'feedback'});
  assert.ok(result.total >= 2);
  assert.equal(result.matches[0].id, 'note-feedback-loops', 'three mentions beat one');
  assert.equal(searchNotes(data, {query: 'feedback loop'}).total, 1, 'every word must match');
  assert.ok(result.matches.every(match => match.snippet.length <= LIMITS.snippet + 2));
  assert.equal(searchNotes(data, {query: 'zebra'}).total, 0);
});

test('search_notes caps the number of results', () => {
  const result = searchNotes(data, {query: 'fictional', limit: 2});
  assert.equal(result.matches.length, 2);
  assert.ok(result.total >= 3);
});

test('notes are validated before use', () => {
  assert.throws(() => parseNotes({}), /array/);
  assert.throws(() => parseNotes([{id: 'a', title: '', body: 'x'}]), /needs id, title and body/);
  assert.throws(() => parseNotes([{id: 'a', title: 'T', body: 'x'.repeat(LIMITS.noteBody + 1)}]), /longer/);
  assert.throws(() => parseNotes([{id: 'a', title: 'T', body: 'x'}, {id: 'a', title: 'U', body: 'y'}]), /Duplicate/);
});

test('input schemas reject bad arguments with a clear message', () => {
  const search = z.object(inputSchemas.search_notes);
  assert.throws(() => search.parse({query: 'a'}), /at least 2/);
  assert.throws(() => search.parse({query: 'ok', limit: 99}), /too_big|less than or equal|<=/);
  assert.throws(() => z.object(inputSchemas.list_unfinished_deadlines).parse({withinDays: 0}));
  assert.doesNotThrow(() => search.parse({query: '  feedback  '}));
});

