// Turns the demo feed into one week of days (Monday to Sunday) that contain today.
import {addDays, weekStart, zonedDateTime} from '../../../src/domain/time.mjs';
import {deadlineDay, resolveDemoFeed, type TodayFeed} from '../../../src/shared/today.ts';

export interface WeekEvent {id: string; title: string; start: string; end: string; location?: string}
export interface WeekDeadline {id: string; title: string; due: string; overdue: boolean}
export interface WeekDay {date: string; isToday: boolean; events: WeekEvent[]; deadlines: WeekDeadline[]}
export interface Week {days: WeekDay[]; timeZone: string}

const DONE = ['complete', 'completed', 'submitted', 'cancelled', 'archived'];

export function buildWeek(feed: TodayFeed, nowMs: number): Week {
  const resolved = resolveDemoFeed(feed, nowMs);
  const today = resolved.anchorDate;
  const timeZone = resolved.timeZone;
  const first = weekStart(today);
  const days = Array.from({length: 7}, (_, index): WeekDay => {
    const date = addDays(first, index);
    const from = Date.parse(zonedDateTime(date, '00:00', {timeZone}));
    const to = Date.parse(zonedDateTime(addDays(date, 1), '00:00', {timeZone}));
    const events = resolved.events
      .filter(event => Date.parse(event.start) < to && Date.parse(event.end) > from)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
      .map(({id, title, start, end, location}) => ({id, title, start, end, ...(location ? {location} : {})}));
    const deadlines = resolved.tasks
      .filter(task => !task.archived && !DONE.includes(task.status ?? ''))
      .filter(task => deadlineDay(task, timeZone) === date)
      .map(task => ({id: task.id, title: task.title, due: date, overdue: date < today}));
    return {date, isToday: date === today, events, deadlines};
  });
  return {days, timeZone};
}

