import { calendarDate, completed, dayOffset, record, rows, Snapshot, text } from './feed';

export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function relativeDay(now: Date, offset: unknown): Date {
  // Calendar construction, rather than adding 24h, preserves local days across DST.
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset(offset), 12);
}
function relativeTime(value: unknown, now: Date): string {
  const spec = record(value), time = text(spec.time);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('Invalid local time');
  const day = relativeDay(now, spec.dayOffset);
  const hour = Number(time.slice(0, 2)), minute = Number(time.slice(3));
  day.setHours(hour, minute, 0, 0);
  // A nonexistent spring-forward time must not silently become a different time.
  if (day.getHours() !== hour || day.getMinutes() !== minute) throw Error('Time does not exist on this day');
  return day.toISOString();
}
export function resolveFeed(value: unknown, now: Date): Snapshot {
  const root = record(value);
  if (root.version !== 1) throw Error('Unsupported feed version');
  return {
    version: 1, source: text(root.source), fetchedAt: now.toISOString(),
    schedule: rows(root.schedule).map(row => {
      const start = relativeTime(row.start, now), end = relativeTime(row.end, now);
      if (start >= end) throw Error('Invalid event range');
      return { id: text(row.id), title: text(row.title), location: text(row.location, true), start, end };
    }),
    deadlines: rows(root.deadlines).map(row => ({
      id: text(row.id), title: text(row.title), course: text(row.course, true),
      dueDate: row.due === null ? null : localDay(relativeDay(now, record(row.due).dayOffset)),
      done: completed(row.done), nextStep: text(row.nextStep, true),
    })),
  };
}
export function selectAgenda(snapshot: Snapshot, now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    schedule: snapshot.schedule.filter(event => new Date(event.start) < end && new Date(event.end) > start)
      .sort((a, b) => a.start.localeCompare(b.start)),
    deadlines: snapshot.deadlines.filter(task => !task.done).sort((a, b) =>
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title)),
  };
}
export function deadlineLabel(due: string | null, now: Date): string {
  if (due === null) return 'Date not confirmed';
  calendarDate(due);
  const today = localDay(now);
  if (due === today) return 'Due today';
  const date = new Date(`${due}T12:00:00`);
  return `${due < today ? 'Overdue' : 'Due'} · ${date.toLocaleDateString('en-CA', {
    month: 'short', day: 'numeric', ...(due.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}),
  })}`;
}
