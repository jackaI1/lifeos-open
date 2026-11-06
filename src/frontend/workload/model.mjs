import {scaleBand, scaleLinear, scaleQuantize} from 'd3-scale';
import {addDays, weekStart, validDate, zonedDateTime, mergeIntervals} from '../../domain/time.mjs';
import {deadlineDay} from '../../shared/today.ts';

export {addDays, weekStart, deadlineDay};
const finished = new Set(['complete', 'completed', 'submitted', 'cancelled', 'archived']);
const data = row => row.data ?? row;
export function estimate(task) {
  const value = task.remainingMinutes ?? task.estimatedMinutes;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

// No clock, DOM, mutation or storage: callers supply a civil date and timezone.
export function buildWeek({tasks = [], events = [], courses = [], date, timeZone = 'America/Toronto'}) {
  const start = weekStart(date), days = Array.from({length: 7}, (_, i) => addDays(start, i));
  const open = tasks.filter(row => !data(row).archived && !finished.has(data(row).status)).map(row => ({id: row.id, ...data(row), day: deadlineDay(data(row), timeZone), minutes: estimate(data(row))}));
  const courseNames = new Map(courses.map(row => [row.id, data(row).code || data(row).title || 'Untitled course']));
  const courseIds = [...new Set(open.map(t => t.courseId || 'unassigned'))].sort();
  const rows = courseIds.map(id => ({id, label: courseNames.get(id) || 'Other tasks'}));
  const cells = rows.flatMap(course => days.map(day => {
    const items = open.filter(t => (t.courseId || 'unassigned') === course.id && t.day === day);
    return {key: course.id + ':' + day, course: course.id, label: course.label, day, tasks: items, count: items.length, minutes: items.reduce((sum, t) => sum + (t.minutes ?? 0), 0), unknown: items.filter(t => t.minutes === null).length};
  }));
  const timed = [], notices = [], invalidEvents = [];
  for (const row of events) {
    const e = data(row);
    if (e.deleted || e.archived || e.status === 'cancelled') continue;
    if (e.start?.date || validDate(e.start) || e.allDay) { notices.push(row); continue; }
    const begin = Date.parse(e.start?.dateTime ?? e.start), end = Date.parse(e.end?.dateTime ?? e.end);
    if (!Number.isFinite(begin) || !Number.isFinite(end) || end <= begin) { invalidEvents.push(row); continue; }
    timed.push({start: begin, end});
  }
  const daily = days.map(day => {
    const startAt = Date.parse(zonedDateTime(day, '00:00', {timeZone, disambiguation: 'earlier'}));
    const endAt = Date.parse(zonedDateTime(addDays(day, 1), '00:00', {timeZone, disambiguation: 'earlier'}));
    const clipped = timed.map(e => ({start: Math.max(startAt, e.start), end: Math.min(endAt, e.end)})).filter(e => e.end > e.start);
    const calendarMinutes = mergeIntervals(clipped).reduce((sum, e) => sum + (Date.parse(e.end) - Date.parse(e.start)) / 60000, 0);
    const items = open.filter(t => t.day === day), taskMinutes = items.reduce((sum, t) => sum + (t.minutes ?? 0), 0);
    return {day, calendarMinutes, taskMinutes, totalMinutes: calendarMinutes + taskMinutes, tasks: items, unknown: items.filter(t => t.minutes === null).length};
  });
  return {start, days, rows, cells, daily, unknownDates: open.filter(t => !t.day), overdue: open.filter(t => t.day && t.day < start), notices: notices.length, invalidEvents: invalidEvents.length, timeZone};
}

// D3 scales map the model to deterministic SVG coordinates and count colours.
export function weekGeometry(model, width = 720) {
  if (!Number.isFinite(width) || width < 400) throw new RangeError('Chart width must be at least 400');
  const left = 128, right = width - 24, bottom = 294;
  const x = scaleLinear().domain([0, Math.max(1, ...model.daily.map(d => d.totalMinutes / 60))]).nice().range([left, right]);
  const y = scaleBand().domain(model.days).range([12, bottom]).padding(0.24);
  const hx = scaleBand().domain(model.days).range([left, right]).padding(0.08);
  const hy = scaleBand().domain(model.rows.map(c => c.id)).range([36, 36 + model.rows.length * 54]).padding(0.12);
  const colour = scaleQuantize().domain([0, Math.max(1, ...model.cells.map(c => c.count))]).range(['var(--recess)', 'color-mix(in srgb, var(--blue) 30%, var(--recess))', 'color-mix(in srgb, var(--blue) 65%, var(--recess))', 'var(--blue)']);
  return {width, left, right, bottom, x, y, hx, hy,
    bars: model.daily.map(d => ({...d, x: left, y: y(d.day), height: y.bandwidth(), calendarWidth: x(d.calendarMinutes / 60) - left, taskX: x(d.calendarMinutes / 60), taskWidth: x(d.totalMinutes / 60) - x(d.calendarMinutes / 60)})),
    cells: model.cells.map(c => ({...c, x: hx(c.day), y: hy(c.course), width: hx.bandwidth(), height: hy.bandwidth(), fill: colour(c.count)})),
    heatHeight: 70 + model.rows.length * 54};
}
