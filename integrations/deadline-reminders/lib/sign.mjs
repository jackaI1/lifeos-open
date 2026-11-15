// Shared rules for the reminder webhook: how events are signed and which tasks are due soon.
// The n8n workflow repeats the same canonical string, and a test checks that both agree.
import {createHmac} from 'node:crypto';

export const EVENT_TYPES = Object.freeze(['deadline.due_soon', 'calendar.changed']);
export const DONE_STATUSES = Object.freeze(['complete', 'completed', 'submitted', 'cancelled', 'archived']);
export const DUE_SOON_MS = 24 * 60 * 60 * 1000;

/** The exact bytes that are signed. Fields are joined by newlines, so a title cannot change the layout. */
export function canonicalString({timestamp, event}) {
  return [timestamp, event.id, event.type, event.occurredAt, event.dueAt ?? '', event.title].join('\n');
}

export function signEvent(secret, timestamp, event) {
  return 'sha256=' + createHmac('sha256', secret).update(canonicalString({timestamp, event})).digest('hex');
}

const oneLine = (value, max) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

/** A deadline within 24 hours becomes one reminder event. The id is stable, so a resend is a replay. */
export function dueSoonEvents(tasks, nowMs, windowMs = DUE_SOON_MS) {
  return tasks
    .filter(task => !task.archived && !DONE_STATUSES.includes(task.status ?? '') && typeof task.dueAt === 'string')
    .filter(task => {
      const due = Date.parse(task.dueAt);
      return Number.isFinite(due) && due > nowMs && due <= nowMs + windowMs;
    })
    .map(task => ({
      id: `deadline:${oneLine(task.id, 80)}:${task.dueAt}`,
      type: 'deadline.due_soon',
      occurredAt: new Date(nowMs).toISOString(),
      dueAt: task.dueAt,
      title: oneLine(task.title, 200) || 'Deadline',
    }));
}

/** Build the signed headers for one event. */
export function signedHeaders(secret, event, nowMs = Date.now()) {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {'content-type': 'application/json', 'x-lifeos-timestamp': timestamp, 'x-lifeos-signature': signEvent(secret, timestamp, event)};
}
