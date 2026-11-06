import {addDays, validDate, localDate, zonedParts, zonedDateTime} from '../domain/time.mjs';
import {lifeosDay} from '../../public/lifeos-day.js';

/** Date-only deadlines are civil dates, never midnight UTC timestamps. */
export interface Deadline {
  id: string;
  title: string;
  dueAt?: string;
  dueDate?: string;
  status?: string;
  archived?: boolean;
}
export interface ScheduleEntry {id: string; title: string; start: string; end: string; location?: string}
export interface TodayFeed {
  schemaVersion: 1;
  fictional: true;
  anchorDate: string;
  timeZone: string;
  events: ScheduleEntry[];
  tasks: Deadline[];
}
export function deadlineDay(task: Pick<Deadline, 'dueAt' | 'dueDate'>, timeZone: string): string | null {
  if (task.dueAt) return Number.isFinite(Date.parse(task.dueAt)) ? localDate(task.dueAt, timeZone) : null;
  return validDate(task.dueDate) ? task.dueDate! : null;
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid demo feed');
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 240): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid demo text');
  return value;
};
const timestamp = (value: unknown): string => {
  const result = text(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !validDate(result.slice(0, 10)) || !Number.isFinite(Date.parse(result))) throw new Error('Invalid demo timestamp');
  return result;
};
function rows<T>(value: unknown, parse: (row: Record<string, unknown>) => T & {id: string}): T[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid demo rows');
  const ids = new Set();
  return value.map(item => {const row = parse(object(item)); if (ids.has(row.id)) throw new Error('Duplicate demo record'); ids.add(row.id); return row;});
}
/** Validate network and disk input and copy only the public fields the client uses. */
export function parseFeed(value: unknown): TodayFeed {
  const feed = object(value);
  if (feed.schemaVersion !== 1 || feed.fictional !== true || !validDate(feed.anchorDate)) throw new Error('Unsupported demo feed');
  const timeZone = text(feed.timeZone, 80);
  new Intl.DateTimeFormat('en', {timeZone}).format(0);
  return {schemaVersion: 1, fictional: true, anchorDate: feed.anchorDate as string, timeZone,
    events: rows(feed.events, row => {
      const start = timestamp(row.start), end = timestamp(row.end);
      if (Date.parse(end) <= Date.parse(start)) throw new Error('Invalid event interval');
      return {id: text(row.id), title: text(row.title), start, end, ...(row.location === undefined ? {} : {location: text(row.location)})};
    }),
    tasks: rows(feed.tasks, row => {
      if (row.dueDate !== undefined && !validDate(row.dueDate)) throw new Error('Invalid deadline date');
      if (row.archived !== undefined && typeof row.archived !== 'boolean') throw new Error('Invalid archived state');
      return {id: text(row.id), title: text(row.title), ...(row.dueAt === undefined ? {} : {dueAt: timestamp(row.dueAt)}), ...(row.dueDate === undefined ? {} : {dueDate: row.dueDate as string}), ...(row.status === undefined ? {} : {status: text(row.status)}), ...(row.archived === undefined ? {} : {archived: row.archived as boolean})};
    })};
}

/** Only call on a fresh download. Persist the result, never a relative template. */
export function resolveDemoFeed(feed: TodayFeed, now: number): TodayFeed {
  const day = lifeosDay(now, feed.timeZone);
  const shift = Math.round((Date.parse(day + 'T12:00Z') - Date.parse(feed.anchorDate + 'T12:00Z')) / 86400000);
  const move = (value: string) => {
    const parts = zonedParts(value, feed.timeZone);
    return zonedDateTime(addDays(parts.date, shift), parts.time, {timeZone: feed.timeZone, disambiguation: 'earlier'});
  };
  return {...feed, anchorDate: day,
    events: feed.events.map(event => ({...event, start: move(event.start), end: move(event.end)})),
    tasks: feed.tasks.map(task => ({...task, ...(task.dueDate ? {dueDate: addDays(task.dueDate, shift)} : {}), ...(task.dueAt ? {dueAt: move(task.dueAt)} : {})}))};
}

export function selectToday(feed: TodayFeed, now: number) {
  const day = lifeosDay(now, feed.timeZone), last = addDays(day, 7);
  const start = Date.parse(zonedDateTime(day, '05:00', {timeZone: feed.timeZone}));
  const end = Date.parse(zonedDateTime(addDays(day, 1), '05:00', {timeZone: feed.timeZone}));
  const tasks = feed.tasks.filter(task => !task.archived && !['complete', 'completed', 'submitted', 'cancelled', 'archived'].includes(task.status ?? '')).map(task => ({...task, day: deadlineDay(task, feed.timeZone)}));
  return {day,
    events: feed.events.filter(event => Date.parse(event.start) < end && Date.parse(event.end) > start).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    deadlines: tasks.filter(task => task.day && task.day <= last).sort((a, b) => a.day!.localeCompare(b.day!) || (a.dueAt ?? '').localeCompare(b.dueAt ?? '') || a.id.localeCompare(b.id)),
    unknown: tasks.filter(task => !task.day)};
}
