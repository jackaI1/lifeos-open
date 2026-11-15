import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createService} from '../src/local/service.ts';
import {todaySchedule, unfinishedDeadlines, searchNotes, readOnly, makeReadOnlyServer, READ_ONLY_TOOLS} from '../src/mcp/readonly.ts';
import {ask, scriptedModel, ollamaModel} from '../src/mcp/assistant.ts';
import {lifeosDay, DEFAULT_TIME_ZONE} from '../src/domain/time.mjs';
import {addDays, zonedDateTime} from '../src/domain/time.mjs';

const TZ = DEFAULT_TIME_ZONE;
const NOW = Date.now();
const day = lifeosDay(NOW, TZ);
const at = (date, time) => zonedDateTime(date, time, {timeZone: TZ});

// Fictional fixtures only. Dates are relative to the day the test runs.
async function seed(app) {
  const put = (kind, id, data) => app.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)')
    .bind(kind, id, JSON.stringify(data), 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z').run();
  await put('calendar-event', 'ev-lab', {title: 'Fictional lab', start: {dateTime: at(day, '14:00')}, end: {dateTime: at(day, '16:00')}, location: 'Room A'});
  await put('calendar-event', 'ev-allday', {title: 'Field day', start: {date: day}, end: {date: addDays(day, 1)}});
  await put('calendar-event', 'ev-far', {title: 'Far away', start: {dateTime: at(addDays(day, 30), '10:00')}, end: {dateTime: at(addDays(day, 30), '11:00')}});
  await put('task', 't-essay', {title: 'Essay draft', dueDate: addDays(day, 2), status: 'todo'});
  await put('task', 't-overdue', {title: 'Old reading', dueDate: addDays(day, -3), status: 'todo'});
  await put('task', 't-done', {title: 'Finished quiz', dueDate: addDays(day, 1), status: 'complete'});
  await put('task', 't-far', {title: 'Final project', dueDate: addDays(day, 40), status: 'todo'});
  await put('learning-note', 'n-heat', {title: 'Heat transfer', text: 'Conduction moves heat through a solid without bulk motion.', type: 'concept', status: 'ready'});
  await put('learning-note', 'n-diffusion', {title: 'Diffusion', text: 'Flux follows a gradient.', misunderstanding: 'Heat is not diffusion', reasoning: 'Fictional reasoning.', type: 'misconception', status: 'learning'});
  await put('learning-note', 'n-archived', {title: 'Archived heat note', text: 'Heat again', archived: true, type: 'concept', status: 'ready'});
}

async function fixtureDb(t) {
  const app = await createService({database: ':memory:', demo: false});
  t.after(() => app.close());
  await seed(app);
  return app.db;
}

test('today_schedule lists events overlapping one local day, all-day first', async t => {
  const db = await fixtureDb(t);
  const result = await todaySchedule(db, {}, {now: NOW, timeZone: TZ});
  assert.equal(result.date, day);
  assert.deepEqual(result.events.map(e => e.id), ['ev-allday', 'ev-lab']);
  assert.equal(result.events[1].location, 'Room A');
  assert.equal(result.truncated, false);
  const empty = await todaySchedule(db, {date: addDays(day, 10)}, {now: NOW, timeZone: TZ});
  assert.equal(empty.count, 0);
});

test('unfinished_deadlines returns open tasks in the window, overdue first, and skips finished ones', async t => {
  const db = await fixtureDb(t);
  const week = await unfinishedDeadlines(db, {withinDays: 7}, {now: NOW, timeZone: TZ});
  assert.deepEqual(week.deadlines.map(d => d.id), ['t-overdue', 't-essay']);
  assert.equal(week.deadlines[0].overdue, true);
  assert.equal(week.deadlines[1].overdue, false);
  const wide = await unfinishedDeadlines(db, {withinDays: 60}, {now: NOW, timeZone: TZ});
  assert.ok(wide.deadlines.some(d => d.id === 't-far'));
  assert.ok(!wide.deadlines.some(d => d.id === 't-done'));
});

test('search_notes matches case-insensitively, skips archived notes and caps results', async t => {
  const db = await fixtureDb(t);
  const hits = await searchNotes(db, {query: 'HEAT'});
  assert.deepEqual(hits.notes.map(n => n.id).sort(), ['n-diffusion', 'n-heat']);
  assert.equal(hits.truncated, false);
  const one = await searchNotes(db, {query: 'heat', limit: 1});
  assert.equal(one.notes.length, 1);
  assert.equal(one.truncated, true);
  assert.ok(one.notes[0].snippet.length <= 161);
  assert.deepEqual((await searchNotes(db, {query: 'nothing-matches-this'})).notes, []);
});

test('the read-only guard refuses writes and stacked statements', async t => {
  const db = await fixtureDb(t);
  const guarded = readOnly(db);
  assert.throws(() => guarded.prepare('DELETE FROM records'), /read-only/);
  assert.throws(() => guarded.prepare('UPDATE records SET version=2'), /read-only/);
  assert.throws(() => guarded.prepare('SELECT 1; DELETE FROM records'), /read-only/);
  assert.equal((await guarded.prepare('SELECT COUNT(*) AS n FROM records').first('n')) > 0, true);
});

test('tool inputs are validated with clear errors through MCP', async t => {
  const db = await fixtureDb(t);
  const server = makeReadOnlyServer(db, {now: NOW, timeZone: TZ});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'validation', version: '1'});
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), [...READ_ONLY_TOOLS].sort());
  const badWindow = await client.callTool({name: 'unfinished_deadlines', arguments: {withinDays: 0}});
  assert.equal(badWindow.isError, true);
  const badDate = await client.callTool({name: 'today_schedule', arguments: {date: '2026-02-31'}});
  assert.equal(badDate.isError, true);
  const good = await client.callTool({name: 'search_notes', arguments: {query: 'heat'}});
  assert.notEqual(good.isError, true);
  assert.equal(good.structuredContent.count, 2);
});

test('an assistant asks about deadlines over stdio, logs each tool call and recovers from a refused one', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'lifeos-mcp-readonly-'));
  const file = join(dir, 'workspace.sqlite');
  const client = new Client({name: 'scripted-assistant', version: '1'});
  try {
    const app = await createService({database: file, demo: false});
    await seed(app);
    await app.close();
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['src/mcp/readonly.ts'],
      env: {...process.env, LIFEOS_MCP_DATABASE: file, LIFEOS_TIME_ZONE: TZ},
      stderr: 'ignore',
    }));
    const logged = [];
    const model = scriptedModel([
      {content: '', toolCalls: [{name: 'unfinished_deadlines', arguments: {withinDays: 7}}]},
      {content: '', toolCalls: [{name: 'delete_all_tasks', arguments: {}}]},
      {content: 'You have an essay draft due in two days.', toolCalls: []},
    ]);
    const {answer, calls} = await ask({question: 'what is due this week?', model, client, log: record => logged.push(record)});
    assert.equal(answer, 'You have an essay draft due in two days.');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].name, 'unfinished_deadlines');
    assert.equal(calls[0].ok, true);
    assert.equal(calls[1].ok, false);
    assert.match(calls[1].summary, /not available/);
    assert.equal(logged.length, 2);
    const toolMessage = model.seen[1].find(message => message.role === 'tool' && message.name === 'unfinished_deadlines');
    assert.match(toolMessage.content, /Essay draft/);
    await assert.rejects(ask({question: 'loop', model: scriptedModel([
      {content: '', toolCalls: [{name: 'today_schedule', arguments: {}}]},
      {content: '', toolCalls: [{name: 'today_schedule', arguments: {}}]},
    ]), client, maxSteps: 1}), /stopped after 1 tool steps/);
  } finally {
    await client.close();
    await rm(dir, {recursive: true, force: true});
  }
});

test('the local model client refuses any host other than this machine', () => {
  assert.doesNotThrow(() => ollamaModel({host: 'http://127.0.0.1:11434', model: 'llama3.2'}));
  assert.throws(() => ollamaModel({host: 'http://10.0.0.5:11434', model: 'llama3.2'}), /loopback/);
});
