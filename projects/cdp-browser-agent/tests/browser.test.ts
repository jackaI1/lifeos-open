import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { BrowserAgent } from '../src/index.js';
import { startFixtures } from '../src/fixtures.js';
import { runBenchmark, scriptedPolicy } from '../src/benchmark.js';

const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('actions, accessibility, event recording and recovery on fixtures', async () => {
  const fixture = await startFixtures();
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const agent = await BrowserAgent.create(page, { timeoutMs: 300, retries: 1 });
    await agent.act({ type: 'navigate', url: fixture.url });
    assert.match(JSON.stringify(await agent.snapshot()), /Name/);
    await agent.act({ type: 'fill', selector: '#name', value: 'Jack' });
    await agent.act({ type: 'click', selector: '#submit' });
    assert.equal(await agent.act({ type: 'extract', selector: '#result' }), 'Hello, Jack!');
    assert.ok(agent.events.some(e => e.kind === 'console'));
    assert.ok(agent.events.some(e => e.kind === 'network'));
    await assert.rejects(agent.act({ type: 'click', selector: '#missing' }));
    await agent.close();
  } finally { await browser.close(); await fixture.close(); }
});

test('benchmark scores the scripted policy on a fresh fixture', async () => {
  const fixture = await startFixtures();
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const agent = await BrowserAgent.create(page);
    const result = await runBenchmark(agent, fixture.url, scriptedPolicy);
    assert.equal(result.success, true);
    assert.equal(result.steps, 3);
    assert.ok(result.latencyMs >= 0);
    await agent.close();
  } finally { await browser.close(); await fixture.close(); }
});
