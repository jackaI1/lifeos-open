// Read-only MCP server for LifeOS. It exposes three tools over stdio: today's schedule,
// unfinished deadlines and a search over saved learning notes. Every tool only reads, every
// result is capped, and the database is opened read-only so a bug here cannot write either.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {addDays, zonedDateTime, DEFAULT_TIME_ZONE} from '../domain/time.mjs';
import {lifeosDay} from '../../public/lifeos-day.js';
import {deadlineDay} from '../shared/today.ts';
import type {WorkspaceDatabase} from '../storage/types.ts';

export const READ_ONLY_TOOLS = Object.freeze(['today_schedule', 'unfinished_deadlines', 'search_notes'] as const);
export const MAX_RESULTS = 50;
const SCAN_LIMIT = 1000;
const DONE_STATUSES = ['complete', 'completed', 'submitted', 'cancelled', 'archived'];

type Row = Record<string, any>;
export type ReadDatabase = Pick<WorkspaceDatabase, 'prepare'>;
export interface ReadOptions {now?: number; timeZone?: string}

/** Only SELECT (or WITH ... SELECT) statements pass. Tools never see write methods. */
export function readOnly(db: ReadDatabase): ReadDatabase {
  return {
    prepare(query: string) {
      if (!/^\s*(select|with)\b/i.test(query) || query.replace(/\s+$/, '').includes(';')) throw Error('This assistant tool is read-only.');
      return db.prepare(query);
    },
  } as ReadDatabase;
}

async function records(db: ReadDatabase, kind: string): Promise<Row[]> {
  const result = await db.prepare('SELECT id,data FROM records WHERE kind=? ORDER BY id LIMIT ?').bind(kind, SCAN_LIMIT).all();
  return result.results.map(row => ({id: String(row.id), ...JSON.parse(String(row.data))}));
}

const midnight = (day: string, timeZone: string) => Date.parse(zonedDateTime(day, '00:00', {timeZone}));

/** Start and end of a calendar event in milliseconds. All-day events use local midnights. */
function interval(event: Row, timeZone: string): {start: number; end: number; startText: string; endText: string} | null {
  if (event.start?.dateTime) {
    const start = Date.parse(event.start.dateTime);
    const end = Date.parse(event.end?.dateTime ?? event.start.dateTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return {start, end, startText: event.start.dateTime, endText: event.end?.dateTime ?? event.start.dateTime};
  }
  if (event.start?.date) {
    const endDate = event.end?.date ?? addDays(event.start.date, 1);
    return {start: midnight(event.start.date, timeZone), end: midnight(endDate, timeZone), startText: event.start.date, endText: endDate};
  }
  return null;
}

/** Calendar events that overlap one local day, earliest first. */
export async function todaySchedule(db: ReadDatabase, input: {date?: string}, {now = Date.now(), timeZone = DEFAULT_TIME_ZONE}: ReadOptions = {}) {
  const day = input.date ?? lifeosDay(now, timeZone);
  const from = midnight(day, timeZone), to = midnight(addDays(day, 1), timeZone);
  const matches = (await records(readOnly(db), 'calendar-event'))
    .map(event => ({event, span: interval(event, timeZone)}))
    .filter(({span}) => span && span.start < to && span.end > from)
    .sort((a, b) => a.span!.start - b.span!.start);
  return {
    date: day,
    timeZone,
    count: matches.length,
    truncated: matches.length > MAX_RESULTS,
    events: matches.slice(0, MAX_RESULTS).map(({event, span}) => ({
      id: event.id,
      title: String(event.title ?? ''),
      start: span!.startText,
      end: span!.endText,
      ...(typeof event.location === 'string' ? {location: event.location} : {}),
    })),
  };
}

/** Open tasks due within the window, including overdue ones, earliest first. */
export async function unfinishedDeadlines(db: ReadDatabase, input: {withinDays?: number}, {now = Date.now(), timeZone = DEFAULT_TIME_ZONE}: ReadOptions = {}) {
  const today = lifeosDay(now, timeZone);
  const through = addDays(today, input.withinDays ?? 14);
  const due = (await records(readOnly(db), 'task'))
    .filter(task => !task.archived && !DONE_STATUSES.includes(task.status ?? ''))
    .map(task => ({task, day: deadlineDay(task, timeZone)}))
    .filter(({day}) => day !== null && day <= through)
    .sort((a, b) => a.day!.localeCompare(b.day!) || String(a.task.dueAt ?? '').localeCompare(String(b.task.dueAt ?? '')) || a.task.id.localeCompare(b.task.id));
  return {
    today,
    through,
    count: due.length,
    truncated: due.length > MAX_RESULTS,
    deadlines: due.slice(0, MAX_RESULTS).map(({task, day}) => ({
      id: task.id,
      title: String(task.title ?? ''),
      due: day,
      overdue: day! < today,
      ...(typeof task.dueAt === 'string' ? {dueAt: task.dueAt} : {}),
      ...(typeof task.status === 'string' ? {status: task.status} : {}),
    })),
  };
}

function snippet(text: string, needle: string) {
  const at = text.toLowerCase().indexOf(needle);
  const start = Math.max(0, at - 60);
  return (start > 0 ? '…' : '') + text.slice(start, start + 160);
}

/** Case-insensitive search over saved learning notes. Matches are capped and shown as short snippets. */
export async function searchNotes(db: ReadDatabase, input: {query: string; limit?: number}, _options: ReadOptions = {}) {
  const needle = input.query.toLowerCase();
  const limit = input.limit ?? 10;
  const hits: {id: string; title: string; snippet: string}[] = [];
  let total = 0;
  for (const note of await records(readOnly(db), 'learning-note')) {
    if (note.archived) continue;
    const fields = [note.title, note.text, note.misunderstanding, note.reasoning].filter((value): value is string => typeof value === 'string');
    const field = fields.find(value => value.toLowerCase().includes(needle));
    if (!field) continue;
    total++;
    if (hits.length < limit) hits.push({id: note.id, title: String(note.title ?? ''), snippet: snippet(field, needle)});
  }
  return {query: input.query, count: total, truncated: total > limit, notes: hits};
}

const text = (message: string) => ({isError: true, content: [{type: 'text' as const, text: message}]});
const ok = (data: unknown) => ({content: [{type: 'text' as const, text: JSON.stringify(data)}], structuredContent: data as Record<string, unknown>});

/** Build the server with exactly the allowlisted tools. Errors are returned as tool errors, not thrown. */
export function makeReadOnlyServer(db: ReadDatabase, options: ReadOptions = {}) {
  const server = new McpServer({name: 'lifeos-readonly', version: '1.0.0'});
  const run = async (fn: () => Promise<unknown>) => {
    try {
      return ok(await fn());
    } catch (error) {
      return text(error instanceof Error ? error.message : 'The tool failed.');
    }
  };
  server.registerTool('today_schedule', {
    description: 'List calendar events that overlap one local day (default today). Read-only, at most 50 events.',
    inputSchema: {date: z.iso.date().optional().describe('Local day as YYYY-MM-DD. Defaults to today.')},
  }, async ({date}) => run(() => todaySchedule(db, {date}, options)));
  server.registerTool('unfinished_deadlines', {
    description: 'List open tasks due within the next N days, including overdue ones. Read-only, at most 50 tasks.',
    inputSchema: {withinDays: z.number().int().min(1).max(60).optional().describe('How many days ahead to look. Defaults to 14.')},
  }, async ({withinDays}) => run(() => unfinishedDeadlines(db, {withinDays}, options)));
  server.registerTool('search_notes', {
    description: 'Search saved learning notes for a word or phrase. Read-only, at most 20 snippets.',
    inputSchema: {
      query: z.string().trim().min(2).max(100).describe('Text to look for, 2 to 100 characters.'),
      limit: z.number().int().min(1).max(20).optional().describe('Most notes to return. Defaults to 10.'),
    },
  }, async ({query, limit}) => run(() => searchNotes(db, {query, limit}, options)));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.env.LIFEOS_MCP_DATABASE;
  if (!file) throw Error('Set LIFEOS_MCP_DATABASE to the workspace file the assistant may read.');
  const {LocalDatabase} = await import('../local/database.ts');
  const db = new LocalDatabase(file, {readOnly: true});
  const server = makeReadOnlyServer(db, {timeZone: process.env.LIFEOS_TIME_ZONE ?? DEFAULT_TIME_ZONE});
  await server.connect(new StdioServerTransport());
  const close = () => { db.db.close(); process.exit(0); };
  process.stdin.once('end', close);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
