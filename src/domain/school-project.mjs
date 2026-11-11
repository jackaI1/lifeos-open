import { DEFAULT_TIME_ZONE } from './time.mjs';

/**
 * Builds a Microsoft Project file (the MSPDI XML format that Project saves and opens)
 * from LifeOS school records. Each course is a summary task, each coursework item is a
 * child task sized from its remaining or estimated minutes, and each due date becomes a
 * "finish no later than" constraint, so Project marks any deadline the work cannot meet.
 * Notes, drafts and attachments are never written to the file.
 */
export const PROJECT_XML_NAMESPACE = 'http://schemas.microsoft.com/project';

const WORKDAY_END = '17:00:00';
const MINUTES_PER_DAY = 480;
const MINUTES_PER_WEEK = 2400;
const FINISH_NO_LATER_THAN = 7; // MSPDI ConstraintType 7 is "Finish no later than" (learn.microsoft.com, Task.ConstraintType).
const DONE_STATUSES = new Set(['complete', 'completed', 'submitted']);
const SKIPPED_STATUSES = new Set(['cancelled', 'archived']);
const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function xmlText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[&<>"']/g, character => XML_ESCAPES[character]);
}

function isCalendarDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Returns the wall-clock date and time in a time zone, so the file shows the owner's local deadlines. */
export function localParts(value, timeZone = DEFAULT_TIME_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

/** Accepts both `{ id, data: {...} }` records and bare objects, as the export and the app use each. */
function recordsOf(records, kind) {
  const items = Array.isArray(records?.[kind]) ? records[kind] : [];
  return items
    .filter(item => item && typeof item === 'object')
    .map(item => ({ ...(item.data && typeof item.data === 'object' ? item.data : item), id: item.id ?? item.data?.id ?? null }));
}

function deadlineOf(task, timeZone) {
  if (typeof task.dueAt === 'string' && Number.isFinite(Date.parse(task.dueAt))) {
    const parts = localParts(task.dueAt, timeZone);
    return { date: parts.date, time: parts.time };
  }
  if (isCalendarDate(task.dueDate)) return { date: task.dueDate, time: WORKDAY_END };
  return null;
}

/** Project schedules in minutes. Work without an estimate gets a 60-minute placeholder, never zero. */
function minutesOf(task) {
  const remaining = Number.isFinite(task.remainingMinutes) && task.remainingMinutes > 0 ? task.remainingMinutes : null;
  const estimate = Number.isFinite(task.estimatedMinutes) && task.estimatedMinutes > 0 ? task.estimatedMinutes : null;
  return Math.max(30, Math.round(remaining ?? estimate ?? 60));
}

function durationText(minutes) {
  return `PT${Math.floor(minutes / 60)}H${minutes % 60}M0S`;
}

function compareTasks(a, b) {
  if (a.due && b.due) return a.due.date.localeCompare(b.due.date) || a.due.time.localeCompare(b.due.time) || a.name.localeCompare(b.name);
  if (a.due || b.due) return a.due ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function courseLabel(course) {
  if (!course) return 'Unassigned';
  return [course.code, course.title].filter(Boolean).join(' ') || 'Course';
}

/**
 * @param {object} input
 * @param {{ task?: object[], course?: object[] }} input.records  Record lists from a LifeOS export.
 * @param {Date|string|number} [input.now]  Time used as the project start and creation date.
 * @param {string} [input.timeZone]  Time zone for due dates.
 * @param {string} [input.title]  Title shown in Project's file properties.
 * @returns {string} A Microsoft Project XML document.
 */
export function buildSchoolProjectXml({ records = {}, now = new Date(), timeZone = DEFAULT_TIME_ZONE, title = 'LifeOS school plan' } = {}) {
  if (!Number.isFinite(Date.parse(now))) throw new RangeError('A valid project start time is required');
  const current = localParts(now, timeZone);
  const courses = new Map(recordsOf(records, 'course').map(course => [course.id, course]));
  const groups = new Map();
  for (const task of recordsOf(records, 'task')) {
    if (task.archived === true || SKIPPED_STATUSES.has(task.status)) continue;
    const key = courses.has(task.courseId) ? task.courseId : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      name: String(task.title || 'Untitled task').trim(),
      due: deadlineOf(task, timeZone),
      minutes: minutesOf(task),
      percent: DONE_STATUSES.has(task.status) ? 100 : 0,
    });
  }
  const orderedGroups = [...groups.entries()]
    .map(([key, tasks]) => ({ label: courseLabel(courses.get(key)), tasks: tasks.sort(compareTasks) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  let uid = 0, wbsIndex = 0;
  const rows = [];
  for (const group of orderedGroups) {
    wbsIndex += 1;
    const summaryUid = ++uid;
    rows.push({ uid: summaryUid, id: summaryUid, name: group.label, wbs: String(wbsIndex), outline: 1, summary: true, minutes: 0, percent: 0, due: null });
    group.tasks.forEach((task, index) => {
      const taskUid = ++uid;
      rows.push({ ...task, uid: taskUid, id: taskUid, wbs: `${wbsIndex}.${index + 1}`, outline: 2, summary: false });
    });
  }

  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<Project xmlns="${PROJECT_XML_NAMESPACE}">`,
    `  <SaveVersion>14</SaveVersion>`,
    `  <Name>${xmlText(title)}.xml</Name>`,
    `  <Title>${xmlText(title)}</Title>`,
    `  <CreationDate>${current.date}T${current.time}</CreationDate>`,
    `  <ScheduleFromStart>1</ScheduleFromStart>`,
    `  <StartDate>${current.date}T08:00:00</StartDate>`,
    `  <CalendarUID>1</CalendarUID>`,
    `  <DefaultStartTime>08:00:00</DefaultStartTime>`,
    `  <DefaultFinishTime>${WORKDAY_END}</DefaultFinishTime>`,
    `  <MinutesPerDay>${MINUTES_PER_DAY}</MinutesPerDay>`,
    `  <MinutesPerWeek>${MINUTES_PER_WEEK}</MinutesPerWeek>`,
    `  <DaysPerMonth>20</DaysPerMonth>`,
    `  <DefaultTaskType>0</DefaultTaskType>`,
    '  <Calendars>',
    '    <Calendar>',
    '      <UID>1</UID>',
    '      <Name>Standard</Name>',
    '      <IsBaseCalendar>1</IsBaseCalendar>',
    '      <IsBaselineCalendar>0</IsBaselineCalendar>',
    '      <BaseCalendarUID>-1</BaseCalendarUID>',
    '      <WeekDays>',
  ];
  for (let dayType = 1; dayType <= 7; dayType += 1) {
    const working = dayType >= 2 && dayType <= 6;
    lines.push(`        <WeekDay><DayType>${dayType}</DayType><DayWorking>${working ? 1 : 0}</DayWorking>${working ? '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>' : ''}</WeekDay>`);
  }
  lines.push('      </WeekDays>', '    </Calendar>', '  </Calendars>', '  <Tasks>');
  for (const row of rows) {
    const tag = (name, value) => `      <${name}>${xmlText(value)}</${name}>`;
    lines.push('    <Task>');
    lines.push(tag('UID', row.uid), tag('ID', row.id), tag('Name', row.name), tag('Type', 0), tag('IsNull', 0));
    lines.push(tag('CreateDate', `${current.date}T${current.time}`), tag('WBS', row.wbs), tag('OutlineNumber', row.wbs), tag('OutlineLevel', row.outline), tag('Priority', 500));
    lines.push(tag('Duration', durationText(row.summary ? 0 : row.minutes)), tag('DurationFormat', 5));
    lines.push(tag('Milestone', 0), tag('Summary', row.summary ? 1 : 0), tag('PercentComplete', row.percent));
    lines.push(tag('ConstraintType', row.due ? FINISH_NO_LATER_THAN : 0), tag('CalendarUID', 1));
    if (row.due) lines.push(tag('ConstraintDate', `${row.due.date}T${row.due.time}`));
    lines.push('    </Task>');
  }
  lines.push('  </Tasks>', '</Project>');
  return `${lines.join('\n')}\n`;
}
