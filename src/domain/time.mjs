export {lifeosDay} from '../../public/lifeos-day.js';
/** Civil-date arithmetic and explicit daylight-saving conversion. */
export const DEFAULT_TIME_ZONE = 'America/Toronto';
const formatters = new Map();

export function instant(value) {
  const result = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(result)) throw new RangeError('A valid timestamp is required');
  return result;
}

export function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(value.valueOf()) && value.toISOString().slice(0, 10) === date;
}

export function addDays(date, count) {
  if (!validDate(date) || !Number.isInteger(count)) throw new RangeError('Invalid civil date or day count');
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

export function weekday(date) {
  if (!validDate(date)) throw new RangeError('Invalid civil date');
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function weekStart(date) { return addDays(date, -((weekday(date) + 6) % 7)); }

export function zonedParts(value, timeZone = DEFAULT_TIME_ZONE) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant(value))).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}`, hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}

export function localDate(value, timeZone = DEFAULT_TIME_ZONE) { return zonedParts(value, timeZone).date; }

/** Reject ambiguous and missing local times unless a repeated-time choice is explicit. */
export function zonedDateTime(date, time, { timeZone = DEFAULT_TIME_ZONE, disambiguation = 'reject' } = {}) {
  if (!validDate(date) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) throw new RangeError('Invalid local date/time');
  const [hour, minute, second = 0] = time.split(':').map(Number);
  if (hour > 23 || minute > 59 || second > 59) throw new RangeError('Invalid clock time');
  if (!['reject', 'earlier', 'later'].includes(disambiguation)) throw new RangeError('Invalid daylight-saving choice');
  const naive = Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
  const offsets = new Set();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const probe = naive + hours * 3_600_000;
    const p = zonedParts(probe, timeZone);
    offsets.add(Date.parse(`${p.date}T${p.time}Z`) - probe);
  }
  const target = `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  const matches = [...offsets].map(offset => naive - offset).filter(value => {
    const p = zonedParts(value, timeZone);
    return `${p.date}T${p.time}` === target;
  }).sort((a, b) => a - b);
  if (!matches.length) throw new RangeError('This local time does not exist because the clock changes');
  if (matches.length > 1 && disambiguation === 'reject') throw new RangeError('This local time occurs twice; choose earlier or later');
  return new Date(disambiguation === 'later' ? matches.at(-1) : matches[0]).toISOString();
}

export function minutesBetween(start, end) { return (instant(end) - instant(start)) / 60_000; }
export function addMinutes(value, minutes) {
  if (!Number.isFinite(minutes)) throw new RangeError('Invalid duration');
  return new Date(instant(value) + minutes * 60_000).toISOString();
}

export function overlap(a, b) { return instant(a.start) < instant(b.end) && instant(b.start) < instant(a.end); }

export function mergeIntervals(intervals) {
  const sorted = intervals.map(i => ({ start: instant(i.start), end: instant(i.end) })).filter(i => i.end > i.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const item of sorted) {
    const last = merged.at(-1);
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else merged.push({ ...item });
  }
  return merged.map(i => ({ start: new Date(i.start).toISOString(), end: new Date(i.end).toISOString() }));
}

export function availableIntervals({ start, end, busy = [], minimumMinutes = 0 }) {
  const begin = instant(start), finish = instant(end);
  if (finish < begin || !Number.isFinite(minimumMinutes) || minimumMinutes < 0) throw new RangeError('Invalid availability window');
  let cursor = begin;
  const result = [];
  for (const item of mergeIntervals(busy)) {
    const a = Math.max(begin, instant(item.start)), b = Math.min(finish, instant(item.end));
    if (b <= begin || a >= finish) continue;
    if (a > cursor) result.push({ start: new Date(cursor).toISOString(), end: new Date(a).toISOString(), minutes: (a - cursor) / 60_000 });
    cursor = Math.max(cursor, b);
  }
  if (cursor < finish) result.push({ start: new Date(cursor).toISOString(), end: new Date(finish).toISOString(), minutes: (finish - cursor) / 60_000 });
  return result.filter(i => i.minutes >= minimumMinutes);
}
