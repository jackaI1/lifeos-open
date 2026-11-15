# Asking a local model about my week

I can ask a model that runs on my computer what is due this week, and it can check
my schedule and notes before it answers. The model never sends those notes to a
cloud service, and it cannot change anything in my planner.

The pieces are a small read-only server that speaks MCP (Model Context Protocol, a
standard way for a model to call named tools) and a loop that connects the server
to a local model through Ollama.

## Try it

From the repository root, after installing Ollama and pulling a small model:

```sh
npm ci
ollama pull qwen2.5:1.5b
node src/mcp/planner/ask.mjs "what is due this week?"
```

The answer prints on stdout. Each tool call is logged as one JSON line on stderr.
To keep the log in a file, set `LIFEOS_TOOL_LOG=./planner-calls.jsonl`. Use
`LIFEOS_PLANNER_MODEL` to choose another model and `OLLAMA_BASE_URL` to point at
another Ollama address.

The server reads the public fictional feed and five fictional notes by default.
To point it at other files, set `LIFEOS_PLANNER_FEED` and `LIFEOS_PLANNER_NOTES`.
Both must match the shapes checked in `src/mcp/planner/tools.mjs`.

## The three tools

| Tool | What it answers | Limits |
| --- | --- | --- |
| `list_today_schedule` | Today's calendar events in order | 50 events |
| `search_notes` | Notes that contain every word I typed | 5 results, 200-character snippets, 2 to 100 characters of query |
| `list_unfinished_deadlines` | Open tasks with a date, overdue ones included | 1 to 60 days ahead, 50 results, undated tasks are counted |

Each tool returns JSON. A bad argument returns a plain sentence such as
"query needs at least 2 characters", so the model can try again.

## How it stays read-only

- The server registers exactly these three tools, each marked `readOnlyHint`.
- The client loop refuses any other tool name, even if a model asks for one, and
  logs the refusal.
- The model only sees the allowlisted tool definitions.
- Each question stops after `maxTurns` (four by default), so a confused model
  cannot loop forever.

## Tests

- `test/planner-mcp-tools.test.mjs` checks each tool with fixed dates: the right
  events for the day, deadline order, overdue handling, ranking, limits and input
  validation.
- `test/planner-mcp-e2e.test.mjs` starts the real stdio server as a child process,
  drives the client loop with a scripted model, and checks that a write tool is
  refused, that bad arguments come back as readable errors, that every call is
  logged, and that the loop stops at its limit. No network model is needed.

Run them with `node --test test/planner-mcp-*.test.mjs`.

## Design notes

The server and the model loop are separate files. The loop takes the model as a
function, so tests can replace Ollama with a script. Logs contain tool names,
argument names, result sizes and timings, not the note text.
The existing writable server in `src/mcp/server.ts` is unchanged; this read-only
server is a separate entry point.
