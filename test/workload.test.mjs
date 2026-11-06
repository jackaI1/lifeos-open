import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWeek, weekGeometry, deadlineDay, estimate} from '../src/frontend/workload/model.mjs';
const task = (id, fields) => ({id, data: {title: id, courseId: 'a', status: 'todo', ...fields}});
const event = (start, end) => ({data: {start: {dateTime: start}, end: {dateTime: end}}});
const base = {date: '2026-10-21', timeZone: 'America/Toronto', courses: [{id: 'a', data: {code: 'SYS 101'}}]};

test('civil week starts Monday and timestamp deadlines use the workspace timezone', () => {
  const model = buildWeek({...base, tasks: [task('late', {dueAt: '2026-10-20T02:00:00Z', remainingMinutes: 90}), task('date-only', {dueDate: '2026-10-20', estimatedMinutes: 30})]});
  assert.deepEqual(model.days, ['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25']);
  assert.equal(model.daily[0].taskMinutes, 90);
  assert.equal(model.daily[1].taskMinutes, 30);
  assert.equal(deadlineDay({dueDate: '2026-02-30'}, 'UTC'), null);
  assert.equal(deadlineDay({dueAt: 'bad', dueDate: '2026-10-20'}, 'UTC'), null);
});

test('completed and archived work is excluded, missing estimates and dates stay explicit', () => {
  const model = buildWeek({...base, tasks: [task('done', {status: 'complete', dueDate: base.date, remainingMinutes: 600}), task('archived', {archived: true}), task('unknown-date', {}), task('unknown-size', {dueDate: base.date}), task('earlier', {dueDate: '2026-10-18', estimatedMinutes: 30})]});
  assert.deepEqual(model.unknownDates.map(t => t.id), ['unknown-date']);
  assert.deepEqual(model.overdue.map(t => t.id), ['earlier']);
  assert.equal(model.daily[2].taskMinutes, 0);
  assert.equal(model.daily[2].unknown, 1);
  assert.equal(model.cells.find(c => c.day === base.date).count, 1);
});

test('zero remaining work wins over old estimates and invalid estimates never become geometry', () => {
  assert.equal(estimate({remainingMinutes: 0, estimatedMinutes: 90}), 0);
  for (const value of [-1, NaN, Infinity, '50']) assert.equal(estimate({remainingMinutes: value}), null);
});

test('calendar overlaps count once and overnight commitments are split at local midnight', () => {
  const model = buildWeek({...base, events: [event('2026-10-20T03:00Z', '2026-10-20T05:00Z'), event('2026-10-20T04:30Z', '2026-10-20T06:00Z'), {data: {start: {date: '2026-10-19'}, end: {date: '2026-10-20'}}}, event('bad', 'bad'), {data: {status: 'cancelled', start: 'bad'}}]});
  assert.equal(model.daily[0].calendarMinutes, 60);
  assert.equal(model.daily[1].calendarMinutes, 120);
  assert.equal(model.notices, 1);
  assert.equal(model.invalidEvents, 1);
});

test('calendar clipping respects the 25-hour daylight-saving day and week boundary', () => {
  const model = buildWeek({date: '2026-11-01', events: [event('2026-11-01T04:00Z', '2026-11-02T05:00Z'), event('2026-10-26T02:00Z', '2026-10-26T05:00Z')]});
  assert.equal(model.daily[6].calendarMinutes, 1500);
  assert.equal(model.daily[0].calendarMinutes, 60);
});

test('course/day matrix contains empty cells and sums the same deadlines as the timeline', () => {
  const model = buildWeek({...base, tasks: [task('one', {dueDate: base.date, remainingMinutes: 120}), task('two', {dueDate: base.date, remainingMinutes: 60}), task('three', {courseId: 'b', dueDate: base.date, remainingMinutes: 15})]});
  assert.equal(model.cells.length, 14);
  assert.equal(model.cells.reduce((n, c) => n + c.count, 0), 3);
  assert.equal(model.cells.reduce((n, c) => n + c.minutes, 0), model.daily.reduce((n, d) => n + d.taskMinutes, 0));
  assert.equal(model.cells.find(c => c.course === 'a' && c.day === base.date).count, 2);
});

test('pure D3 geometry has proportional widths, aligned cells and bounded finite coordinates', () => {
  const input = {...base, tasks: [task('one', {dueDate: '2026-10-19', remainingMinutes: 60}), task('two', {dueDate: '2026-10-20', remainingMinutes: 120})]};
  const before = JSON.stringify(input), model = buildWeek(input), g = weekGeometry(model);
  assert.equal(g.bars[1].taskWidth, 2 * g.bars[0].taskWidth);
  assert.equal(g.cells[0].x, g.hx(model.days[0]));
  assert.equal(g.cells[0].y, g.hy('a'));
  for (const b of g.bars) {assert.ok(Number.isFinite(b.taskWidth)); assert.ok(b.taskX + b.taskWidth <= g.right + 0.001); assert.ok(b.y + b.height <= g.bottom);}
  assert.deepEqual(weekGeometry(buildWeek(input)).bars, g.bars);
  assert.equal(JSON.stringify(input), before);
  assert.throws(() => weekGeometry(model, 100), RangeError);
});

test('empty weeks keep valid axes and no phantom heat-map cells', () => {
  const model = buildWeek(base), g = weekGeometry(model);
  assert.equal(g.bars.length, 7);
  assert.equal(g.cells.length, 0);
  assert.deepEqual(g.x.domain(), [0, 1]);
  assert.ok(g.bars.every(b => b.calendarWidth === 0 && b.taskWidth === 0));
});
