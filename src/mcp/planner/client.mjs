// A small loop between a local model and the read-only planner tools.
// The model only ever sees the allowlisted tools, and every call is logged.
import {TOOL_NAMES} from './tools.mjs';

const SYSTEM = 'You answer questions about the user\'s schedule, deadlines and notes. Use the tools for facts. Say plainly when the tools find nothing. Never invent dates.';

/** Ollama's local chat endpoint. Nothing leaves the machine unless OLLAMA_BASE_URL points away from it. */
export function ollamaChat(baseUrl = 'http://127.0.0.1:11434') {
  return async request => {
    const response = await fetch(new URL('/api/chat', baseUrl), {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`The local model returned HTTP ${response.status}`);
    return response.json();
  };
}

const parseArguments = value => (typeof value === 'string' ? JSON.parse(value) : value ?? {});

/**
 * Ask one question. `chat` sends a request and returns {message}; `mcp` is an MCP
 * client connected to the planner server; `log` receives one object per tool call.
 */
export async function askPlanner({question, chat, mcp, model, maxTurns = 4, log = () => {}}) {
  const {tools} = await mcp.listTools();
  const specs = tools.filter(tool => TOOL_NAMES.includes(tool.name)).map(tool => ({
    type: 'function',
    function: {name: tool.name, description: tool.description, parameters: tool.inputSchema},
  }));
  const messages = [{role: 'system', content: SYSTEM}, {role: 'user', content: question}];
  let calls = 0;
  for (let turn = 1; turn <= maxTurns; turn++) {
    const {message} = await chat({model, messages, tools: specs, stream: false, options: {temperature: 0}});
    messages.push(message);
    const requested = message.tool_calls ?? [];
    if (!requested.length) return {answer: message.content ?? '', turns: turn, toolCalls: calls};
    for (const call of requested) {
      const name = call.function?.name;
      const started = Date.now();
      let text;
      if (!TOOL_NAMES.includes(name)) {
        text = JSON.stringify({error: `Tool ${name} is not allowed`});
        log({turn, tool: name, allowed: false, ms: Date.now() - started});
      } else {
        let args;
        try { args = parseArguments(call.function.arguments); } catch { args = null; }
        if (args === null) {
          text = JSON.stringify({error: 'Tool arguments were not valid JSON'});
          log({turn, tool: name, allowed: true, ok: false, ms: Date.now() - started});
        } else {
          const result = await mcp.callTool({name, arguments: args});
          text = result.content?.map(part => part.text ?? '').join('') ?? '';
          calls++;
          log({turn, tool: name, allowed: true, ok: !result.isError, args, bytes: text.length, ms: Date.now() - started});
        }
      }
      messages.push({role: 'tool', tool_name: name, content: text});
    }
  }
  throw new Error(`The planner stopped after ${maxTurns} tool turns without an answer.`);
}
