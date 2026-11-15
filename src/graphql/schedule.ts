// Read-only GraphQL API over the LifeOS schedule and deadlines. The resolvers call the same
// read-only functions as the MCP tools, so both front ends share one set of rules.
import {buildSchema, execute, parse, validate, specifiedRules, Kind, type DocumentNode, type ValidationRule} from 'graphql';
import {zonedDateTime} from '../domain/time.mjs';
import {todaySchedule, unfinishedDeadlines, type ReadDatabase, type ReadOptions} from '../mcp/readonly.ts';

export const LIMITS = Object.freeze({maxQueryBytes: 2000, maxDepth: 4, maxFields: 40, maxWithinDays: 60});
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const schema = buildSchema(`
  "The local day's events and open deadlines."
  type Day {
    date: String!
    timeZone: String!
    events: [Event!]!
    deadlines: [Deadline!]!
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
    due: String!
    overdue: Boolean!
    dueAt: String
    status: String
  }
  type Query {
    "Today's schedule, or the schedule for a YYYY-MM-DD date."
    day(date: String): Day!
    "Open tasks due within the next withinDays days, overdue first."
    deadlines(withinDays: Int = 14): [Deadline!]!
  }
`);

/** Reject queries that nest too deep, select too many fields, or are too large to be a normal request. */
export function limitRule(maxDepth = LIMITS.maxDepth, maxFields = LIMITS.maxFields): ValidationRule {
  return context => {
    let fields = 0;
    const walk = (selections: readonly any[] | undefined, depth: number) => {
      for (const selection of selections ?? []) {
        if (selection.kind === Kind.FIELD) {
          fields++;
          if (depth > maxDepth) context.reportError(new Error(`Query is nested deeper than ${maxDepth} levels.`));
          walk(selection.selectionSet?.selections, depth + 1);
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          walk(selection.selectionSet.selections, depth);
        }
      }
    };
    return {
      Document(node: DocumentNode) {
        for (const definition of node.definitions) {
          if (definition.kind === Kind.OPERATION_DEFINITION) walk(definition.selectionSet.selections, 1);
        }
        if (fields > maxFields) context.reportError(new Error(`Query selects more than ${maxFields} fields.`));
      },
    };
  };
}

export const validationRules = [...specifiedRules, limitRule()];

function dateArgument(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !DATE.test(value)) throw new Error('date must be YYYY-MM-DD.');
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error('date is not a real calendar day.');
  return value;
}

/** Resolver map. Each field only reads; nothing here writes to the database. */
export function resolvers(db: ReadDatabase, options: ReadOptions = {}) {
  return {
    day: async ({date}: {date?: unknown}) => {
      const result = await todaySchedule(db, {date: dateArgument(date)}, options);
      // Anchor at noon on the requested day, so "through today" means through that day, overdue included.
      const anchor = Date.parse(zonedDateTime(result.date, '12:00', {timeZone: result.timeZone}));
      const deadlines = await unfinishedDeadlines(db, {withinDays: 0}, {timeZone: result.timeZone, now: anchor});
      return {date: result.date, timeZone: result.timeZone, events: result.events, deadlines: deadlines.deadlines};
    },
    deadlines: async ({withinDays}: {withinDays?: unknown}) => {
      if (withinDays !== undefined && (!Number.isInteger(withinDays) || (withinDays as number) < 1 || (withinDays as number) > LIMITS.maxWithinDays)) {
        throw new Error(`withinDays must be a whole number from 1 to ${LIMITS.maxWithinDays}.`);
      }
      return (await unfinishedDeadlines(db, {withinDays: withinDays as number | undefined}, options)).deadlines;
    },
  };
}

export interface ExecuteOutcome {status: number; body: unknown}

/** Parse, validate and run one request. Mutations and subscriptions are refused before execution. */
export async function runQuery(db: ReadDatabase, {query, variables}: {query: unknown; variables?: unknown}, options: ReadOptions & {rules?: ValidationRule[]} = {}): Promise<ExecuteOutcome> {
  if (typeof query !== 'string' || query.length === 0) return {status: 400, body: {errors: [{message: 'Send a query string.'}]}};
  if (Buffer.byteLength(query) > LIMITS.maxQueryBytes) return {status: 413, body: {errors: [{message: `Queries are limited to ${LIMITS.maxQueryBytes} bytes.`}]}};
  let document: DocumentNode;
  try {
    document = parse(query);
  } catch (error) {
    return {status: 400, body: {errors: [{message: error instanceof Error ? error.message : 'Invalid query.'}]}};
  }
  const operations = document.definitions.filter(definition => definition.kind === Kind.OPERATION_DEFINITION);
  if (operations.some(operation => operation.operation !== 'query')) return {status: 400, body: {errors: [{message: 'Only read queries are allowed.'}]}};
  const errors = validate(schema, document, options.rules ?? validationRules);
  if (errors.length) return {status: 400, body: {errors: errors.map(error => ({message: error.message}))}};
  const variableValues = (variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {}) as Record<string, unknown>;
  const result = await execute({schema, document, rootValue: resolvers(db, options), variableValues});
  return {status: 200, body: JSON.parse(JSON.stringify(result))};
}

