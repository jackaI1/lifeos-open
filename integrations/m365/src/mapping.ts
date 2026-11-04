import {createHash} from 'node:crypto';
import {localDate} from '../../../src/domain/time.mjs';
import type {GraphColumnDefinition, GraphFields} from './graph-types.ts';
import type {LifeosTask} from './lifeos-source.ts';

/** Display names shown in the SharePoint Status choice column. The reminder flow depends on them. */
export const STATUS_LABELS = {
  open: 'Not started',
  active: 'In progress',
  blocked: 'Blocked',
  waiting: 'Waiting',
  done: 'Completed',
  archived: 'Archived',
} as const;

const STATUS_BY_LIFEOS: Record<string, string> = {
  todo: STATUS_LABELS.open,
  'in-progress': STATUS_LABELS.active,
  blocked: STATUS_LABELS.blocked,
  waiting: STATUS_LABELS.waiting,
  complete: STATUS_LABELS.done,
  completed: STATUS_LABELS.done,
  submitted: STATUS_LABELS.done,
  cancelled: STATUS_LABELS.archived,
  archived: STATUS_LABELS.archived,
};

export const mapStatus = (status: string): string => STATUS_BY_LIFEOS[status] ?? STATUS_LABELS.open;

/** Internal names of the columns this integration owns. */
export const COLUMN = {
  id: 'LifeOSId',
  course: 'Course',
  dueDate: 'DueDate',
  dueAt: 'DueAt',
  status: 'Status',
  minutes: 'EstimatedMinutes',
  hash: 'SyncHash',
} as const;

export const MANAGED_FIELDS = ['Title', ...Object.values(COLUMN)];

export const LIST_COLUMNS: GraphColumnDefinition[] = [
  {name: COLUMN.id, displayName: 'LifeOS ID', description: 'Stable identifier of the LifeOS task. Do not edit.', indexed: true, text: {}},
  {name: COLUMN.course, displayName: 'Course', text: {}},
  {name: COLUMN.dueDate, displayName: 'Due date', dateTime: {displayAs: 'default', format: 'dateOnly'}},
  {name: COLUMN.dueAt, displayName: 'Due at', dateTime: {displayAs: 'default', format: 'dateTime'}},
  {name: COLUMN.status, displayName: 'Status', choice: {allowTextEntry: false, displayAs: 'dropDownMenu', choices: Object.values(STATUS_LABELS)}},
  {name: COLUMN.minutes, displayName: 'Estimated minutes', number: {decimalPlaces: 'none'}},
  {name: COLUMN.hash, displayName: 'Sync hash', description: 'Change detector written by the LifeOS sync. Do not edit.', text: {}},
];

/** Fields as stored in SharePoint, without the hash. Nulls clear a column on update. */
export interface DesiredItem {
  lifeosId: string;
  fields: GraphFields;
  hash: string;
}

const isoInstant = (value: string | null): string | null => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

const dateOnlyValue = (date: string): string => `${date}T00:00:00Z`;

export function toDesiredItem(task: LifeosTask, timeZone: string): DesiredItem {
  const dueAt = isoInstant(task.dueAt);
  const dueDate = task.dueDate ?? (dueAt ? localDate(dueAt, timeZone) : null);
  const course = [task.courseCode, task.courseTitle].filter(Boolean).join(' – ');
  const fields: GraphFields = {
    Title: task.title.slice(0, 255) || '(untitled task)',
    [COLUMN.id]: task.id,
    [COLUMN.course]: course || null,
    // Date-only columns hold midnight UTC; the reminder flow reads them without a time zone shift.
    [COLUMN.dueDate]: dueDate ? dateOnlyValue(dueDate) : null,
    [COLUMN.dueAt]: dueAt,
    [COLUMN.status]: mapStatus(task.status),
    [COLUMN.minutes]: task.estimatedMinutes,
  };
  const hash = createHash('sha256').update(JSON.stringify(fields)).digest('hex').slice(0, 16);
  return {lifeosId: task.id, fields, hash};
}
