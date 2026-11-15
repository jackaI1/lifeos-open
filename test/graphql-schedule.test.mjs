import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../src/local/service.ts';
import {runQuery, limitRule, schema, LIMITS} from '../src/graphql/schedule.ts';
import {createGraphqlServer} from '../src/graphql/server.ts';
import {addDays, zonedDateTime, DEFAULT_TIME_ZONE, lifeosDay} from '../src/domain/time.mjs';

const TZ = DEFAULT_TIME_ZONE;
const NOW = Date.now();
const day = lifeosDay(NOW, TZ);
const at = (date, time) => zonedDateTime(date, time, {timeZone: TZ});
const TOKEN = 'fictional-graphql-token-0123456789';

async function fixtureDb(t) {
  const app = await createService({database: ':memory:', demo: false});
  t.after(() => app.close());
  const put = (kind, id, data) => app.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)')
    .bind(kind, id, JSON.stringify(data), 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z').run();
  await put('calendar-event', 'ev-lab', {title: 'Fictional lab', start: {dateTime: at(day, '14:00')}, end: {dateTime: at(day, '16:00')}, location: 'Room A'});
  await put('task', 't-essay', {title: 'Essay draft', dueDate: addDays(day, 2), status: 'todo'});
  await put('task', 't-old', {title: 'Old reading', dueDate: addDays(day, -2), status: 'todo'});
  await put('task', 't-done', {title: 'Finished quiz', dueDate: addDays(day, 1), status: 'complete'});
  return app.db;
}

test('day returns events and deadlines for the requested date', async t => {
  const db = await fixtureDb(t);
  const outcome = await runQuery(db, {query: '{ day { date events { title location } deadlines { title overdue } } }'}, {now: NOW, timeZone: TZ});
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.data.day.date, day);
  assert.deepEqual(outcome.body.data.day.events, [{title: 'Fictional lab', location: 'Room A'}]);
  assert.deepEqual(outcome.body.data.day.deadlines.map(d => d.title), ['Old reading']);
  const later = addDays(day, 2);
  const future = await runQuery(db, {query: `{ day(date: "${later}") { deadlines { title overdue } } }`}, {now: NOW, timeZone: TZ});
  assert.deepEqual(future.body.data.day.deadlines.map(d => [d.title, d.overdue]), [['Old reading', true], ['Essay draft', false]]);
});

test('deadlines honours withinDays and rejects out-of-range values', async t => {
  const db = await fixtureDb(t);
  const week = await runQuery(db, {query: '{ deadlines(withinDays: 7) { id due overdue } }'}, {now: NOW, timeZone: TZ});
  assert.deepEqual(week.body.data.deadlines.map(d => d.id), ['t-old', 't-essay']);
  const defaulted = await runQuery(db, {query: '{ deadlines { id } }'}, {now: NOW, timeZone: TZ});
  assert.equal(defaulted.body.data.deadlines.length, 2);
  const bad = await runQuery(db, {query: '{ deadlines(withinDays: 0) { id } }'}, {now: NOW, timeZone: TZ});
  assert.match(bad.body.errors[0].message, /withinDays must be/);
  const big = await runQuery(db, {query: `{ deadlines(withinDays: ${LIMITS.maxWithinDays + 1}) { id } }`}, {now: NOW, timeZone: TZ});
  assert.match(big.body.errors[0].message, /withinDays must be/);
});

test('invalid dates are refused, including impossible calendar days', async t => {
  const db = await fixtureDb(t);
  for (const date of ['2026-2-1', '2026-02-31', 'tomorrow']) {
    const outcome = await runQuery(db, {query: `{ day(date: "${date}") { date } }`}, {now: NOW, timeZone: TZ});
    assert.ok(outcome.body.errors, date);
  }
});

test('mutations, syntax errors, deep nesting and oversized queries are refused before running', async t => {
  const db = await fixtureDb(t);
  const mutation = await runQuery(db, {query: 'mutation { day { date } }'}, {now: NOW});
  assert.equal(mutation.status, 400);
  assert.match(mutation.body.errors[0].message, /read queries/);
  assert.equal((await runQuery(db, {query: '{ day { '})).status, 400);
  const shallow = await runQuery(db, {query: '{ day { events { title } } }'}, {rules: [limitRule(2, 40)], now: NOW});
  assert.match(shallow.body.errors[0].message, /nested deeper than 2/);
  const wide = await runQuery(db, {query: '{ day { date timeZone events { id title start end location } deadlines { id title due overdue dueAt status } } }'}, {rules: [limitRule(4, 5)]});
  assert.match(wide.body.errors[0].message, /more than 5 fields/);
  const huge = await runQuery(db, {query: '{ day { date } } # ' + 'x'.repeat(LIMITS.maxQueryBytes)});
  assert.equal(huge.status, 413);
  assert.equal(schema.getQueryType().name, 'Query');
  assert.equal(schema.getMutationType() ?? null, null);
});

test('the HTTP endpoint needs the token, POST and JSON, and bounds the body', async t => {
  const db = await fixtureDb(t);
  const server = createGraphqlServer(db, {token: TOKEN, timeZone: TZ, now: () => NOW});
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const url = `http://127.0.0.1:${server.address().port}/graphql`;
  const post = (body, headers = {}) => fetch(url, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers}, body});
  assert.equal((await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'})).status, 401);
  assert.equal((await fetch(url, {headers: {authorization: `Bearer ${TOKEN}`}})).status, 405);
  assert.equal((await post('{}', {'content-type': 'text/plain'})).status, 415);
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post(JSON.stringify({query: '{ day { date } }'}))).status, 200);
  assert.equal((await post(JSON.stringify({query: '{ day { date } }', padding: 'x'.repeat(9000)}))).status, 413);
  const ok = await (await post(JSON.stringify({query: '{ deadlines(withinDays: 7) { title } }'}))).json();
  assert.deepEqual(ok.data.deadlines.map(d => d.title), ['Old reading', 'Essay draft']);
  assert.throws(() => createGraphqlServer(db, {token: 'short'}), /at least 24/);
});
