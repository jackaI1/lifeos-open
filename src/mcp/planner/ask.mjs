// Command line: node src/mcp/planner/ask.mjs "what is due this week?"
// Starts the read-only server over stdio, asks the local model, logs each tool call.
import {appendFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {askPlanner, ollamaChat} from './client.mjs';

export async function ask(question, {model = process.env.LIFEOS_PLANNER_MODEL ?? 'qwen2.5:1.5b', baseUrl = process.env.OLLAMA_BASE_URL, logPath = process.env.LIFEOS_TOOL_LOG, chat} = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
    env: {...process.env, LIFEOS_PLANNER_NOW: process.env.LIFEOS_PLANNER_NOW ?? ''},
    stderr: 'ignore',
  });
  const mcp = new Client({name: 'lifeos-planner-ask', version: '1.0.0'});
  await mcp.connect(transport);
  const log = async entry => {
    const line = JSON.stringify({at: new Date().toISOString(), ...entry}) + '\n';
    if (logPath) await appendFile(logPath, line);
    else process.stderr.write(line);
  };
  try {
    return await askPlanner({question, mcp, model, chat: chat ?? ollamaChat(baseUrl), log});
  } finally {
    await mcp.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const question = process.argv.slice(2).join(' ').trim();
  if (question.length < 3) {
    console.error('Usage: node src/mcp/planner/ask.mjs "what is due this week?"');
    process.exit(2);
  }
  const {answer, toolCalls} = await ask(question);
  console.log(answer);
  console.error(`(${toolCalls} tool calls)`);
}
