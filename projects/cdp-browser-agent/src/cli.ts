import { chromium } from 'playwright-core';
import { BrowserAgent } from './index.js';
import { startFixtures } from './fixtures.js';
import { ollamaPolicy, runBenchmark, scriptedPolicy } from './benchmark.js';
const fixture = await startFixtures();
try {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
  try {
    for (const [name, policy] of [['scripted', scriptedPolicy], ...(process.env.OLLAMA_MODEL ? [['ollama', ollamaPolicy(process.env.OLLAMA_MODEL)] as const] : [])] as const) {
      const page = await browser.newPage();
      try { const agent = await BrowserAgent.create(page); try { console.log(JSON.stringify({ policy: name, ...await runBenchmark(agent, fixture.url, policy) })); } finally { await agent.close(); } } finally { await page.close(); }
    }
  } finally { await browser.close(); }
} finally { await fixture.close(); }
