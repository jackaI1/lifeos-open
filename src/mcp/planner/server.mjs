// Read-only planner MCP server. It registers exactly the tools in TOOL_NAMES and
// never writes; stdout belongs to the protocol, so logs go to stderr.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {inputSchemas, parsePlannerData, todaySchedule, unfinishedDeadlines, searchNotes} from './tools.mjs';

const DEFAULT_FEED = new URL('../../../public/demo/today.json', import.meta.url);
const DEFAULT_NOTES = new URL('./fixtures/notes.json', import.meta.url);

export async function loadPlannerData({feedPath = DEFAULT_FEED, notesPath = DEFAULT_NOTES} = {}) {
  const [feed, notes] = await Promise.all([readFile(feedPath, 'utf8'), readFile(notesPath, 'utf8')]);
  return parsePlannerData({feed: JSON.parse(feed), notes: JSON.parse(notes)});
}

const asText = value => ({content: [{type: 'text', text: JSON.stringify(value)}]});
const asError = message => ({isError: true, content: [{type: 'text', text: message}]});

/** Each tool returns JSON text, or an isError result with a plain message the model can read. */
export function createPlannerServer(data, {now = () => Date.now()} = {}) {
  const server = new McpServer({name: 'lifeos-planner-readonly', version: '1.0.0'});
  const run = fn => async args => {
    try {
      return asText(fn(args ?? {}));
    } catch (error) {
      return asError(error instanceof Error ? error.message : 'The planner could not answer that request.');
    }
  };
  server.registerTool('list_today_schedule', {
    description: 'List today\'s calendar events in order, with start and end times. Read-only.',
    inputSchema: inputSchemas.list_today_schedule,
    annotations: {readOnlyHint: true},
  }, run(() => todaySchedule(data, now())));
  server.registerTool('search_notes', {
    description: 'Search saved lecture and task notes by words. Returns up to 5 matches with short snippets. Read-only.',
    inputSchema: inputSchemas.search_notes,
    annotations: {readOnlyHint: true},
  }, run(args => searchNotes(data, args)));
  server.registerTool('list_unfinished_deadlines', {
    description: 'List open tasks with a due date, including overdue ones, within a number of days from today. Read-only.',
    inputSchema: inputSchemas.list_unfinished_deadlines,
    annotations: {readOnlyHint: true},
  }, run(args => unfinishedDeadlines(data, now(), args)));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = await loadPlannerData({
    feedPath: process.env.LIFEOS_PLANNER_FEED ?? DEFAULT_FEED,
    notesPath: process.env.LIFEOS_PLANNER_NOTES ?? DEFAULT_NOTES,
  });
  const fixedNow = process.env.LIFEOS_PLANNER_NOW ? Date.parse(process.env.LIFEOS_PLANNER_NOW) : undefined;
  const server = createPlannerServer(data, {now: () => fixedNow ?? Date.now()});
  await server.connect(new StdioServerTransport());
}
