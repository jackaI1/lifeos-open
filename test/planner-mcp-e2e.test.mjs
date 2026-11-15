// End to end: the real stdio server runs as a child process, and a scripted model
// drives the client loop. No network model is needed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {askPlanner} from '../src/mcp/planner/client.mjs';

const SERVER = fileURLToPath(new URL('../src/mcp/planner/server.mjs', import.meta.url));
const NOW = '2026-10-06T16:00:00Z';

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: {...process.env, LIFEOS_PLANNER_NOW: NOW},
    stderr: 'ignore',
  });
  const client = new Client({name: 'scripted-test-client', version: '1.0.0'});
  await client.connect(transport);
  return client;
}

/** A model that replays a fixed script, recording each request it receives. */
function scriptedModel(replies) {
  const requests = [];
  const chat = async request => {
    requests.push(structuredClone({...request, tools: request.tools.map(t => t.function.name)}));
    const reply = replies.shift();
    if (!reply) throw new Error('scripted model ran out of replies');
    return {message: {role: 'assistant', content: reply.content ?? '', ...(reply.tool_calls ? {tool_calls: reply.tool_calls} : {})}};
  };
  return {chat, requests};
}

const call = (name, args) => ({function: {name, arguments: args}});

test('a multi-turn question uses allowed tools, refuses a write tool, and logs every call', async () => {
  const client = await connect();
  try {
    const {chat, requests} = scriptedModel([
      {tool_calls: [call('list_unfinished_deadlines', {withinDays: 7})]},
      {tool_calls: [call('create_task', {title: 'Not allowed'})]},
      {tool_calls: [call('search_notes', {query: 'feedback'})]},
      {content: 'The outline is due first. Your notes mention feedback in lecture 4.'},
    ]);
    const log = [];
    const result = await askPlanner({question: 'what is due this week?', chat, mcp: client, model: 'scripted', maxTurns: 5, log: entry => log.push(entry)});

    assert.equal(result.turns, 4);
    assert.equal(result.toolCalls, 2, 'only executed allowlisted calls count');
    assert.match(result.answer, /outline/);
    assert.deepEqual(requests[0].tools, ['list_today_schedule', 'search_notes', 'list_unfinished_deadlines'],
      'the model is offered only the read-only tools');
    assert.deepEqual(log.map(entry => [entry.tool, entry.allowed, entry.ok ?? null]), [
      ['list_unfinished_deadlines', true, true],
      ['create_task', false, null],
      ['search_notes', true, true],
    ]);
    const firstResult = JSON.parse(requests[1].messages.at(-1).content);
    assert.ok(Array.isArray(firstResult.deadlines), 'the model receives the tool result as JSON');
    assert.ok(log[0].bytes > 0 && log[2].bytes > 0, 'results report their size without logging their text');
  } finally {
    await client.close();
  }
});

test('the server lists exactly the three read-only tools', async () => {
  const client = await connect();
  try {
    const {tools} = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['list_today_schedule', 'list_unfinished_deadlines', 'search_notes']);
    for (const tool of tools) assert.equal(tool.annotations?.readOnlyHint, true);
  } finally {
    await client.close();
  }
});

test('bad arguments come back as a readable tool error the model can act on', async () => {
  const client = await connect();
  try {
    const {chat} = scriptedModel([
      {tool_calls: [call('search_notes', {query: 'a'})]},
      {content: 'I need a longer search word.'},
    ]);
    const log = [];
    const result = await askPlanner({question: 'find my notes', chat, mcp: client, model: 'scripted', log: entry => log.push(entry)});
    assert.equal(result.answer, 'I need a longer search word.');
    assert.equal(log[0].ok, false);
  } finally {
    await client.close();
  }
});

test('the loop stops after the turn limit instead of looping forever', async () => {
  const client = await connect();
  try {
    const {chat} = scriptedModel(Array.from({length: 3}, () => ({tool_calls: [call('list_today_schedule', {})]})));
    await assert.rejects(
      askPlanner({question: 'loop', chat, mcp: client, model: 'scripted', maxTurns: 2}),
      /stopped after 2 tool turns/,
    );
  } finally {
    await client.close();
  }
});
