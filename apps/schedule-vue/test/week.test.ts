import {describe, expect, it} from 'vitest';
import {buildWeek} from '../src/week.ts';
import {parseFeed} from '../../../src/shared/today.ts';

// A small fictional feed. Dates are shifted to the test's day by resolveDemoFeed, so the test stays stable.
const feed = parseFeed({
  schemaVersion: 1, fictional: true, anchorDate: '2026-10-06', timeZone: 'America/Toronto',
  events: [
    {id: 'ev-lab', title: 'Fictional lab', start: '2026-10-06T14:00:00Z', end: '2026-10-06T16:00:00Z', location: 'Room A'},
    {id: 'ev-talk', title: 'Fictional talk', start: '2026-10-08T14:00:00Z', end: '2026-10-08T15:00:00Z'},
  ],
  tasks: [
    {id: 't-essay', title: 'Essay draft', dueDate: '2026-10-09', status: 'todo'},
    {id: 't-done', title: 'Finished quiz', dueDate: '2026-10-07', status: 'complete'},
  ],
});

describe('buildWeek', () => {
  it('returns seven days from Monday, marks today, and places events and deadlines on their days', () => {
    const now = Date.parse('2026-11-18T15:00:00Z'); // a Wednesday
    const week = buildWeek(feed, now);
    expect(week.days).toHaveLength(7);
    expect(week.days[0].date).toBe('2026-11-16');
    expect(week.days.map(day => day.isToday)).toEqual([false, false, true, false, false, false, false]);
    // The feed's anchor day (the lab) is shifted onto today; the talk is two days after the anchor.
    expect(week.days[2].events.map(event => event.title)).toEqual(['Fictional lab']);
    expect(week.days[2].events[0].location).toBe('Room A');
    expect(week.days[4].events.map(event => event.title)).toEqual(['Fictional talk']);
    expect(week.days[0].events).toEqual([]);
  });

  it('keeps only open deadlines, on the day they are due, and marks ones before today as overdue', () => {
    const now = Date.parse('2026-11-18T15:00:00Z');
    const week = buildWeek(feed, now);
    const due = week.days.flatMap(day => day.deadlines.map(item => ({day: day.date, title: item.title, overdue: item.overdue})));
    expect(due).toEqual([{day: '2026-11-21', title: 'Essay draft', overdue: false}]);
    expect(due.some(item => item.title === 'Finished quiz')).toBe(false);
  });
});
