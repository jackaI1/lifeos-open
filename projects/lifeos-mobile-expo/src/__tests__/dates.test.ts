import feed from '../../public/lifeos-demo.json';
import { resolveFeed, selectAgenda, localDay, deadlineLabel } from '../dates';

const now = new Date(2026, 10, 5, 9);

test('resolves the public feed to local calendar days and chronological unfinished deadlines', () => {
  const snapshot = resolveFeed(feed, now);
  expect(localDay(new Date(snapshot.schedule[0]!.start))).toBe('2026-11-05');
  expect(new Date(snapshot.schedule[0]!.start).getHours()).toBe(10);
  expect(snapshot.fetchedAt).toBe(now.toISOString());
  expect(selectAgenda(snapshot, now).deadlines.map(d => d.id)).toEqual([
    'demo-task-outline', 'demo-task-reading', 'demo-task-watershed-diagram',
    'demo-task-model-comparison', 'demo-task-date-unverified',
  ]);
});

test.each([
  [new Date(2026, 11, 31, 23), '2027-01-02'],
  [new Date(2026, 1, 28, 23), '2026-03-02'],
  [new Date(2026, 2, 7, 23), '2026-03-09'],
  [new Date(2026, 9, 31, 23), '2026-11-02'],
])('uses calendar arithmetic across year, month and daylight saving boundaries', (date, due) => {
  expect(resolveFeed(feed, date).deadlines[0]!.dueDate).toBe(due);
});

test('never moves cached events to today when a saved snapshot is viewed tomorrow', () => {
  expect(selectAgenda(resolveFeed(feed, now), new Date(2026, 10, 6)).schedule).toEqual([]);
});

test('includes overnight events overlapping today, but excludes events ending at midnight', () => {
  const snapshot = resolveFeed(feed, now);
  snapshot.schedule = [
    { id: 'overnight', title: 'Night study', location: '', start: new Date(2026, 10, 4, 23).toISOString(), end: new Date(2026, 10, 5, 1).toISOString() },
    { id: 'ended', title: 'Yesterday', location: '', start: new Date(2026, 10, 4, 22).toISOString(), end: new Date(2026, 10, 5).toISOString() },
  ];
  expect(selectAgenda(snapshot, now).schedule.map(e => e.id)).toEqual(['overnight']);
});

test('filters completed tasks and keeps overdue tasks and unknown dates visible', () => {
  const snapshot = resolveFeed(feed, now);
  snapshot.deadlines[0]!.done = true;
  snapshot.deadlines[1]!.dueDate = '2026-11-01';
  const agenda = selectAgenda(snapshot, now);
  expect(agenda.deadlines).toHaveLength(4);
  expect(agenda.deadlines[0]!.title).toBe('Read the watershed example');
  expect(deadlineLabel('2026-11-01', now)).toBe('Overdue · Nov 1');
  expect(deadlineLabel('2026-11-05', now)).toBe('Due today');
  expect(deadlineLabel(null, now)).toBe('Date not confirmed');
});

test.each([
  { ...feed, version: 2 },
  { ...feed, schedule: [{ ...feed.schedule[0], start: { dayOffset: 0, time: '25:00' } }] },
  { ...feed, deadlines: [{ ...feed.deadlines[0], done: 'false' }] },
  { ...feed, schedule: [feed.schedule[0], feed.schedule[0]] },
  { ...feed, schedule: [{ ...feed.schedule[0], end: { dayOffset: 0, time: '09:00' } }] },
  { ...feed, deadlines: [{ ...feed.deadlines[0], due: { dayOffset: 0.5 } }] },
  null,
])('rejects invalid or unsupported feeds before use', value => {
  expect(() => resolveFeed(value, now)).toThrow();
});
