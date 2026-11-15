// Read-only planner tools. Pure functions over a validated snapshot, so every
// tool can be tested without starting a server or a model.
import {z} from 'zod';
import {parseFeed, resolveDemoFeed, selectToday, deadlineDay} from '../../shared/today.ts';
import {addDays, validDate} from '../../domain/time.mjs';

export const TOOL_NAMES = Object.freeze(['list_today_schedule', 'search_notes', 'list_unfinished_deadlines']);
export const LIMITS = Object.freeze({events: 50, deadlines: 50, notesReturned: 5, notes: 200, noteBody: 5000, snippet: 200, withinDays: 60, terms: 8});
const DONE = new Set(['complete', 'completed', 'submitted', 'cancelled', 'archived']);

/** Input schemas are typed here and advertised to the model through MCP. */
export const inputSchemas = Object.freeze({
  list_today_schedule: {},
  search_notes: {
    query: z.string().trim().min(2, 'query needs at least 2 characters').max(100, 'query is limited to 100 characters'),
    limit: z.number().int().min(1).max(LIMITS.notesReturned).optional(),
  },
  list_unfinished_deadlines: {
    withinDays: z.number().int().min(1).max(LIMITS.withinDays).optional(),
  },
});

/** Validate the notes file the same way the feed is validated: bounded, typed, no surprises. */
export function parseNotes(value) {
  if (!Array.isArray(value) || value.length > LIMITS.notes) throw new Error(`Notes must be an array of at most ${LIMITS.notes} items`);
  const ids = new Set();
  return value.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Each note must be an object');
    const {id, title, body} = item;
    if (typeof id !== 'string' || !id || typeof title !== 'string' || !title.trim() || typeof body !== 'string') throw new Error('Each note needs id, title and body text');
    if (body.length > LIMITS.noteBody) throw new Error(`Note ${id} is longer than ${LIMITS.noteBody} characters`);
    if (ids.has(id)) throw new Error(`Duplicate note id ${id}`);
    ids.add(id);
    return {id, title, body, ...(typeof item.updatedAt === 'string' ? {updatedAt: item.updatedAt} : {})};
  });
}

/** The feed keeps its own validation; notes are checked here. Both are copied, never shared. */
export function parsePlannerData({feed, notes}) {
  return {feed: parseFeed(feed), notes: parseNotes(notes)};
}

const pickEvent = event => ({id: event.id, title: event.title, start: event.start, end: event.end, ...(event.location ? {location: event.location} : {})});

export function todaySchedule(data, now) {
  const feed = resolveDemoFeed(data.feed, now);
  const {day, events} = selectToday(feed, now);
  return {day, timeZone: feed.timeZone, events: events.slice(0, LIMITS.events).map(pickEvent), truncated: events.length > LIMITS.events};
}

export function unfinishedDeadlines(data, now, {withinDays = 14} = {}) {
  const feed = resolveDemoFeed(data.feed, now);
  const {day} = selectToday(feed, now);
  const last = addDays(day, withinDays);
  const open = feed.tasks.filter(task => !task.archived && !DONE.has(task.status ?? ''));
  const dated = open.map(task => ({id: task.id, title: task.title, status: task.status ?? 'todo', day: deadlineDay(task, feed.timeZone)}));
  const due = dated.filter(task => task.day && task.day <= last).sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  const undated = dated.filter(task => !task.day).length;
  return {
    today: day,
    deadlines: due.slice(0, LIMITS.deadlines).map(task => ({...task, overdue: task.day < day})),
    truncated: due.length > LIMITS.deadlines,
    withoutDate: undated,
  };
}

const lower = text => text.toLocaleLowerCase('en-CA');

function snippet(body, term) {
  const index = term ? lower(body).indexOf(term) : -1;
  const start = Math.max(0, (index < 0 ? 0 : index) - 60);
  const text = body.slice(start, start + LIMITS.snippet).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${text}${start + LIMITS.snippet < body.length ? '…' : ''}`;
}

/** Every query word must appear somewhere in the title or body. Results are ranked by how often they appear. */
export function searchNotes(data, {query, limit = LIMITS.notesReturned}) {
  const terms = lower(query).split(/\s+/).filter(Boolean).slice(0, LIMITS.terms);
  if (!terms.length) throw new Error('query needs a word to search for');
  const hits = [];
  for (const note of data.notes) {
    const haystack = lower(`${note.title}\n${note.body}`);
    if (!terms.every(term => haystack.includes(term))) continue;
    const score = terms.reduce((total, term) => total + (haystack.split(term).length - 1), 0);
    const first = terms.find(term => lower(note.body).includes(term));
    hits.push({id: note.id, title: note.title, score, snippet: snippet(note.body, first), ...(note.updatedAt ? {updatedAt: note.updatedAt} : {})});
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return {query, matches: hits.slice(0, limit), total: hits.length};
}

export function assertCivilDate(value) {
  if (!validDate(value)) throw new Error('Date must be YYYY-MM-DD');
  return value;
}
