// Turns the demo feed into a seven-day view. Pure: the same feed and clock always give the same week.
import {deadlineDay, resolveDemoFeed, type TodayFeed} from '../../../src/shared/today';
import {addDays, localDate} from '../../../src/domain/time.mjs';
import {lifeosDay} from '../../../public/lifeos-day.js';
import type {WeekSchedule, WeekDeadline, WeekEvent} from './types';

const DONE = new Set(['complete', 'completed', 'submitted', 'cancelled', 'archived']);

export function buildWeek(feed: TodayFeed, now: number): WeekSchedule {
  const resolved = resolveDemoFeed(feed, now);
  const timeZone = resolved.timeZone;
  const start = lifeosDay(now, timeZone);
  const days = Array.from({length: 7}, (_, offset) => {
    const date = addDays(start, offset);
    return {date, events: [] as WeekEvent[], deadlines: [] as WeekDeadline[]};
  });
  const byDate = new Map(days.map(day => [day.date, day]));

  for (const event of resolved.events) {
    const day = byDate.get(localDate(event.start, timeZone));
    if (day) day.events.push({id: event.id, title: event.title, start: event.start, end: event.end, ...(event.location ? {location: event.location} : {})});
  }
  for (const day of days) day.events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

  const overdue: WeekDeadline[] = [];
  let withoutDate = 0;
  for (const task of resolved.tasks) {
    if (task.archived || DONE.has(task.status ?? '')) continue;
    const due = deadlineDay(task, timeZone);
    if (!due) { withoutDate++; continue; }
    const item: WeekDeadline = {id: task.id, title: task.title, day: due, status: task.status ?? 'todo', overdue: due < start};
    if (due < start) overdue.push(item);
    else byDate.get(due)?.deadlines.push(item);
  }
  for (const day of days) day.deadlines.sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  overdue.sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  return {start, timeZone, days, overdue, withoutDate};
}
