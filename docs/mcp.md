# Letting an agent work with my schedule

I can let a compatible agent read saved commitments and request a new task
without giving it the whole workspace. MCP, the Model Context Protocol, is a
standard way for an agent to discover and call named tools.

After `make install`, I generate a random token and configure its scopes through
environment variables. These examples use placeholders; replace them locally:

```sh
export MCP_TOKENS='{"replace-with-a-random-token-at-least-24-characters":["schedule:read","tasks:write"]}'
export MCP_TOKEN='replace-with-a-random-token-at-least-24-characters'
node src/mcp/server.ts
# Or the loopback Streamable HTTP endpoint:
node src/mcp/server.ts --http
```

Stdio carries messages through the process's input and output, with no port.
Streamable HTTP serves `http://127.0.0.1:8791/mcp` and requires
`Authorization: Bearer <token>` on every request. Keep this loopback-only setup
behind an authenticated gateway if using it remotely. The server checks Host
and Origin and limits requests to 60 per minute per token. A read-only token
contains only `schedule:read`. Do not commit tokens or paste them into logs.

An agent can use the official TypeScript client:

```js
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const client = new Client({name:'my-planner', version:'1'});
await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8791/mcp'), {
  requestInit:{headers:{authorization:'Bearer '+process.env.MCP_TOKEN}}
}));
try {
  console.log(await client.callTool({name:'read_schedule',arguments:{}}));
  const queued = await client.callTool({name:'create_task',arguments:{
    title:'Check the fictional pre-lab',dueDate:'2026-11-10',idempotencyKey:'prelab-2026-11-10'
  }});
  const {jobId} = JSON.parse(queued.content[0].text);
  console.log(await client.callTool({name:'job_status',arguments:{jobId}}));
  // Poll job_status until completed or failed. Reuse the key if delivery is uncertain.
} finally {await client.close();}
```

`read_deadlines` returns open dated tasks. `create_task` validates the title and
civil date, returns a job id immediately, then a worker writes through the
normal LifeOS API with its mutation protections. Jobs persist in the workspace
database, retry up to three times with backoff, time out, and requeue on restart.
A token can poll only its own jobs. Reusing a key with different content is
rejected. The queue is capped; a response is not proof of a completed write.

`node --test test/mcp.test.mjs` drives both transports with the
[official MCP client](https://ts.sdk.modelcontextprotocol.io/client). It checks
actual saved tasks, duplicate delivery, schema rejection, read-only denial,
missing authentication, rate limiting, retries and timeouts. No model or agent
account is needed. Stop with Ctrl-C; tests close their spawned processes.
