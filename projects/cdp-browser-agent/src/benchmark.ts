import { BrowserAgent, type Action } from './index.js';
export type Policy = (observation: { task: string; tree: Awaited<ReturnType<BrowserAgent['snapshot']>>; step: number }) => Promise<Action | null>;
export const task = 'Enter Ada in the Name field, click Greet, and make the page say Hello, Ada!';
export const scriptedPolicy: Policy = async ({ step }) => ([{ type: 'fill', selector: '#name', value: 'Ada' }, { type: 'click', selector: '#submit' }, { type: 'extract', selector: '#result' }] as Action[])[step] ?? null;
export function ollamaPolicy(model: string, endpoint = 'http://127.0.0.1:11434'): Policy {
  return async observation => {
    const response = await fetch(`${endpoint}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: false, format: 'json', messages: [{ role: 'system', content: 'Return one JSON action: {"type":"fill","selector":"CSS","value":"text"}, {"type":"click","selector":"CSS"}, or {"type":"extract","selector":"CSS"}. Return {"type":"done"} when finished. Use the accessibility tree and task. The page has selectors #name, #submit, #result.' }, { role: 'user', content: JSON.stringify(observation) }] }) });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const data = await response.json() as { message?: { content?: string } };
    const action = JSON.parse(data.message?.content ?? '{}');
    if (action.type === 'done') return null;
    if (!['click', 'fill', 'extract'].includes(action.type) || typeof action.selector !== 'string' || (action.type === 'fill' && typeof action.value !== 'string')) throw new Error('Invalid model action');
    return action as Action;
  };
}
export async function runBenchmark(agent: BrowserAgent, url: string, policy: Policy, maxSteps = 8) {
  const started = performance.now(); let steps = 0; let error: string | undefined;
  try {
    await agent.act({ type: 'navigate', url });
    while (steps < maxSteps) { const action = await policy({ task, tree: await agent.snapshot(), step: steps }); if (!action) break; steps++; await agent.act(action); }
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  let success = false;
  try { success = (await agent.act({ type: 'extract', selector: '#result' })) === 'Hello, Ada!'; } catch { /* failed page is a failed task */ }
  return { success, steps, latencyMs: Math.round(performance.now() - started), ...(error ? { error } : {}) };
}
