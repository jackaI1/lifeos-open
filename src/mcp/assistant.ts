// Small client loop: a local model answers a question by calling the read-only LifeOS tools.
// Every tool call is checked against the allowlist, bounded by a step limit, and logged.
// The model runs on this machine (Ollama on loopback), so the calendar and notes never leave it.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {READ_ONLY_TOOLS} from './readonly.ts';

export interface ToolSpec {name: string; description: string; parameters: Record<string, unknown>}
export interface ToolCall {name: string; arguments: Record<string, unknown>}
export interface ChatMessage {role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: {function: ToolCall}[]; name?: string}
export interface ModelTurn {content: string; toolCalls: ToolCall[]}
export interface ChatModel {chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ModelTurn>}
export interface CallRecord {name: string; arguments: Record<string, unknown>; ok: boolean; ms: number; summary: string}

export const SYSTEM_PROMPT = 'You answer questions about the user\'s own schedule, deadlines and notes. Use the tools for facts. Say when a tool returns nothing. Never invent dates or titles.';
const MAX_SUMMARY = 200;

/** Ask one question. Returns the final answer and every tool call that was made. */
export async function ask({question, model, client, maxSteps = 4, log = () => {}}: {question: string; model: ChatModel; client: Client; maxSteps?: number; log?: (record: CallRecord) => void}) {
  const tools: ToolSpec[] = (await client.listTools()).tools
    .filter(tool => (READ_ONLY_TOOLS as readonly string[]).includes(tool.name))
    .map(tool => ({name: tool.name, description: tool.description ?? '', parameters: tool.inputSchema as Record<string, unknown>}));
  const messages: ChatMessage[] = [{role: 'system', content: SYSTEM_PROMPT}, {role: 'user', content: question}];
  const calls: CallRecord[] = [];
  for (let step = 0; step < maxSteps; step++) {
    const turn = await model.chat(messages, tools);
    if (turn.toolCalls.length === 0) return {answer: turn.content, calls};
    messages.push({role: 'assistant', content: turn.content, tool_calls: turn.toolCalls.map(call => ({function: call}))});
    for (const call of turn.toolCalls) {
      const started = performance.now();
      const allowed = tools.some(tool => tool.name === call.name);
      const result = allowed
        ? await client.callTool({name: call.name, arguments: call.arguments})
        : {isError: true, content: [{type: 'text', text: `Tool ${call.name} is not available.`}]};
      const text = String((result.content as {text?: string}[])[0]?.text ?? '');
      const record: CallRecord = {name: call.name, arguments: call.arguments, ok: !result.isError, ms: Math.round(performance.now() - started), summary: text.slice(0, MAX_SUMMARY)};
      calls.push(record);
      log(record);
      messages.push({role: 'tool', name: call.name, content: text});
    }
  }
  throw Error(`The assistant stopped after ${maxSteps} tool steps without an answer.`);
}

/** A fixed sequence of model turns, for tests. */
export function scriptedModel(turns: ModelTurn[]): ChatModel & {seen: ChatMessage[][]} {
  const seen: ChatMessage[][] = [];
  let next = 0;
  return {
    seen,
    async chat(messages) {
      seen.push(messages.map(message => ({...message})));
      const turn = turns[next++];
      if (!turn) throw Error('Scripted model ran out of turns.');
      return turn;
    },
  };
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Ollama's chat API with tool calling, restricted to a loopback address so data stays on this machine. */
export function ollamaModel({host = 'http://127.0.0.1:11434', model}: {host?: string; model: string}): ChatModel {
  const url = new URL(host);
  if (!LOOPBACK.has(url.hostname)) throw Error('The local model must run on this machine (loopback address).');
  return {
    async chat(messages, tools) {
      const response = await fetch(new URL('/api/chat', url), {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({model, stream: false, messages, tools: tools.map(tool => ({type: 'function', function: tool}))}),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw Error(`Local model answered with status ${response.status}.`);
      const body = await response.json() as {message?: {content?: string; tool_calls?: {function?: {name?: string; arguments?: Record<string, unknown>}}[]}};
      return {
        content: String(body.message?.content ?? ''),
        toolCalls: (body.message?.tool_calls ?? []).map(call => ({name: String(call.function?.name ?? ''), arguments: call.function?.arguments ?? {}})),
      };
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) throw Error('Usage: npm run assistant -- "what is due this week?"');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('./readonly.ts', import.meta.url))],
    env: {...process.env, LIFEOS_MCP_DATABASE: process.env.LIFEOS_MCP_DATABASE ?? ''} as Record<string, string>,
    stderr: 'inherit',
  });
  const client = new Client({name: 'lifeos-assistant', version: '1.0.0'});
  await client.connect(transport);
  try {
    const model = ollamaModel({host: process.env.OLLAMA_HOST, model: process.env.OLLAMA_MODEL ?? 'llama3.2'});
    const {answer} = await ask({question, model, client, log: record => console.error(JSON.stringify({tool: record.name, ok: record.ok, ms: record.ms, arguments: record.arguments}))});
    console.log(answer);
  } finally {
    await client.close();
  }
}
