// Read-only GraphQL endpoint over the schedule and deadlines. Resolvers read a
// ScheduleSource: the public demo feed, or the same SQLite records the local app uses.
import {buildSchema, graphql, GraphQLError, Kind, parse, validate, type DocumentNode, type ExecutionResult, type SelectionSetNode} from "graphql";
import {deadlineDay, parseFeed, resolveDemoFeed, selectToday, type Deadline, type ScheduleEntry, type TodayFeed} from "../../../src/shared/today";
import {addDays, validDate} from "../../../src/domain/time.mjs";
import {lifeosDay} from "../../../public/lifeos-day.js";
import {PLANNER_QUERY, type PlannerToday} from "./planner-query";
import demoFeedJson from "../../../public/demo/today.json";

export {PLANNER_QUERY};
export type {PlannerToday};

export type Limits = {
  maxQueryBytes: number;
  maxDepth: number;
  maxFields: number;
  maxEvents: number;
  maxDeadlines: number;
  deadlineDays: {min: number; max: number; default: number};
};
export const LIMITS: Limits = Object.freeze({
  maxQueryBytes: 2000,
  maxDepth: 3,
  maxFields: 40,
  maxEvents: 50,
  maxDeadlines: 50,
  deadlineDays: {min: 1, max: 60, default: 14},
});
const DONE = new Set(["complete", "completed", "submitted", "cancelled", "archived"]);

export const SCHEMA = buildSchema(`
  type Query {
    "Today's events and open deadlines. Read-only."
    today(deadlineDays: Int = 14): Today!
  }
  type Today {
    day: String!
    timeZone: String!
    events: [Event!]!
    deadlines: [Deadline!]!
    "Open tasks with no due date. They are counted, never guessed."
    withoutDate: Int!
  }
  type Event {
    id: ID!
    title: String!
    start: String!
    end: String!
    location: String
  }
  type Deadline {
    id: ID!
    title: String!
    day: String!
    status: String!
    overdue: Boolean!
  }
`);

/** Everything a resolver needs. Same fields as the feed, without fake schema metadata. */
export type PlannerFeed = {timeZone: string; events: ScheduleEntry[]; tasks: Deadline[]};
export interface ScheduleSource {
  load(now: number): Promise<PlannerFeed>;
}

export function todayView(feed: PlannerFeed, now: number, deadlineDays: number): PlannerToday {
  // selectToday only reads timeZone, events and tasks; the other fields are filled to satisfy its type.
  const shaped = {...feed, schemaVersion: 1, fictional: true, anchorDate: lifeosDay(now, feed.timeZone)} as TodayFeed;
  const {day, events} = selectToday(shaped, now);
  const last = addDays(day, deadlineDays);
  const dated = feed.tasks
    .filter(task => !task.archived && !DONE.has(task.status ?? ""))
    .map(task => ({task, day: deadlineDay(task, feed.timeZone)}));
  const due = dated
    .filter((item): item is {task: Deadline; day: string} => item.day !== null && item.day <= last)
    .sort((a, b) => a.day.localeCompare(b.day) || (a.task.dueAt ?? "").localeCompare(b.task.dueAt ?? "") || a.task.id.localeCompare(b.task.id));
  return {
    day,
    timeZone: feed.timeZone,
    events: events.slice(0, LIMITS.maxEvents).map(event => ({id: event.id, title: event.title, start: event.start, end: event.end, location: event.location ?? null})),
    deadlines: due.slice(0, LIMITS.maxDeadlines).map(({task, day: due}) => ({id: task.id, title: task.title, day: due, status: task.status ?? "todo", overdue: due < day})),
    withoutDate: dated.filter(item => item.day === null).length,
  };
}

/** Only fields and operations are allowed. Fragments and mutations are refused before execution. */
export function measure(document: DocumentNode) {
  let maxDepth = 0;
  let fields = 0;
  const walk = (set: SelectionSetNode | undefined, depth: number): void => {
    if (!set) return;
    for (const selection of set.selections) {
      if (selection.kind !== Kind.FIELD) throw new GraphQLError("Fragments are not supported on this endpoint.");
      fields++;
      maxDepth = Math.max(maxDepth, depth + 1);
      walk(selection.selectionSet, depth + 1);
    }
  };
  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION || definition.operation !== "query") throw new GraphQLError("Only read-only queries are accepted.");
    walk(definition.selectionSet, 0);
  }
  return {maxDepth, fields};
}

const failure = (message: string): ExecutionResult => ({errors: [{message} as GraphQLError]});

/** Input checks first (size, shape, depth, fields), then GraphQL validation, then execution. */
export async function runScheduleQuery(body: unknown, options: {source: ScheduleSource; now?: number; limits?: Limits}): Promise<ExecutionResult> {
  const limits = options.limits ?? LIMITS;
  if (!body || typeof body !== "object" || typeof (body as {query?: unknown}).query !== "string") return failure("Send a JSON body with a query string.");
  const {query, variables} = body as {query: string; variables?: unknown};
  if (variables !== undefined && (typeof variables !== "object" || variables === null || Array.isArray(variables))) return failure("variables must be an object.");
  if (new TextEncoder().encode(query).length > limits.maxQueryBytes) return failure(`Queries are limited to ${limits.maxQueryBytes} bytes.`);
  let document: DocumentNode;
  try {
    document = parse(query);
    const {maxDepth, fields} = measure(document);
    if (maxDepth > limits.maxDepth) return failure(`Queries may nest at most ${limits.maxDepth} levels deep.`);
    if (fields > limits.maxFields) return failure(`Queries may ask for at most ${limits.maxFields} fields.`);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "The query is not valid.");
  }
  const invalid = validate(SCHEMA, document);
  if (invalid.length) return {errors: invalid};
  const now = options.now ?? Date.now();
  const feed = await options.source.load(now);
  // GraphQL builds null-prototype objects; JSON copies them into plain ones that React can pass to client components.
  const result = await graphql({
    schema: SCHEMA,
    source: query,
    variableValues: variables as Record<string, unknown> | undefined,
    rootValue: {
      today: ({deadlineDays}: {deadlineDays?: number}) => {
        const days = deadlineDays ?? limits.deadlineDays.default;
        if (!Number.isInteger(days) || days < limits.deadlineDays.min || days > limits.deadlineDays.max) {
          throw new GraphQLError(`deadlineDays must be between ${limits.deadlineDays.min} and ${limits.deadlineDays.max}.`);
        }
        return todayView(feed, now, days);
      },
    },
  });
  return JSON.parse(JSON.stringify(result)) as ExecutionResult;
}

/** The public demo feed (imported at build time), moved to today's date exactly as the Today page does it. */
export function demoFeedSource(raw: unknown = demoFeedJson): ScheduleSource {
  return {
    async load(now) {
      const feed = resolveDemoFeed(parseFeed(raw), now);
      return {timeZone: feed.timeZone, events: feed.events, tasks: feed.tasks};
    },
  };
}

/** Reads the same SQLite records table the local app writes. Invalid rows are skipped, never guessed. */
export function localDatabaseSource(file: string, {timeZone = "America/Toronto", eventKind = "calendar-event", taskKind = "task"} = {}): ScheduleSource {
  return {
    async load() {
      const {LocalDatabase} = await import("../../../src/local/database");
      const db = new LocalDatabase(file, {readOnly: true});
      try {
        const rows = (await db.prepare("SELECT kind, id, data FROM records WHERE kind IN (?, ?) LIMIT 1000").bind(eventKind, taskKind).all()).results;
        const events: ScheduleEntry[] = [];
        const tasks: Deadline[] = [];
        for (const row of rows) {
          let data: Record<string, unknown>;
          try { data = JSON.parse(String(row.data)); } catch { continue; }
          const id = String(row.id);
          if (typeof data.title !== "string" || !data.title.trim()) continue;
          if (row.kind === eventKind) {
            const start = typeof data.start === "string" ? Date.parse(data.start) : NaN;
            const end = typeof data.end === "string" ? Date.parse(data.end) : NaN;
            if (Number.isFinite(start) && Number.isFinite(end) && end > start) events.push({id, title: data.title, start: data.start as string, end: data.end as string, ...(typeof data.location === "string" ? {location: data.location} : {})});
          } else if (row.kind === taskKind) {
            const dueAt = typeof data.dueAt === "string" && Number.isFinite(Date.parse(data.dueAt)) ? data.dueAt : undefined;
            const dueDate = typeof data.dueDate === "string" && validDate(data.dueDate) ? data.dueDate : undefined;
            tasks.push({id, title: data.title, ...(dueAt ? {dueAt} : {}), ...(dueDate ? {dueDate} : {}), ...(typeof data.status === "string" ? {status: data.status} : {}), ...(data.archived === true ? {archived: true} : {})});
          }
        }
        return {timeZone, events, tasks};
      } finally {
        db.close();
      }
    },
  };
}
