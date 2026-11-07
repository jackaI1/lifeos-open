export interface Event {
  id: string;
  title: string;
  location: string;
  start: string;
  end: string;
}
export interface Deadline {
  id: string;
  title: string;
  course: string;
  dueDate: string | null;
  done: boolean;
  nextStep: string;
}
export interface Snapshot {
  version: 1;
  source: string;
  fetchedAt: string;
  schedule: Event[];
  deadlines: Deadline[];
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid feed object');
  return value as Record<string, unknown>;
}
export function text(value: unknown, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > 1000 || (!allowEmpty && !value.trim())) throw Error('Invalid feed text');
  return value;
}
export function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 1000) throw Error('Invalid feed list');
  const result = value.map(record);
  const ids = result.map(row => text(row.id));
  if (new Set(ids).size !== ids.length) throw Error('Duplicate feed IDs');
  return result;
}
export function completed(value: unknown): boolean {
  if (typeof value !== 'boolean') throw Error('Invalid completion flag');
  return value;
}
export function dayOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > 365) throw Error('Invalid day offset');
  return value;
}
export function calendarDate(value: unknown): string {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Invalid calendar date');
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw Error('Impossible calendar date');
  return date;
}
function instant(value: unknown): string {
  const date = text(value);
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== date) throw Error('Invalid timestamp');
  return date;
}
export function parseSnapshot(value: unknown): Snapshot {
  const root = record(value);
  if (root.version !== 1) throw Error('Unsupported snapshot version');
  return {
    version: 1, source: text(root.source), fetchedAt: instant(root.fetchedAt),
    schedule: rows(root.schedule).map(row => {
      const start = instant(row.start), end = instant(row.end);
      if (start >= end) throw Error('Invalid event range');
      return { id: text(row.id), title: text(row.title), location: text(row.location, true), start, end };
    }),
    deadlines: rows(root.deadlines).map(row => ({
      id: text(row.id), title: text(row.title), course: text(row.course, true),
      dueDate: row.dueDate === null ? null : calendarDate(row.dueDate),
      done: completed(row.done), nextStep: text(row.nextStep, true),
    })),
  };
}
