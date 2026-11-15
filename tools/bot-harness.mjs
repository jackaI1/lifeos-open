// Runs real Chromium through Playwright in three modes and three input patterns,
// then scores what the browser collector saw. Every browser and context it opens
// is closed in a finally block; nothing is left running after a run.
//   node tools/bot-harness.mjs            -> prints a table, writes test-results/bot-harness.json
//   headed mode needs a display (xvfb-run -a on Linux CI)
import {chromium} from 'playwright';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {scoreSignals} from '../src/bot-detection/score.mjs';

export const MODES = Object.freeze(['headed', 'headless', 'stealth']);
export const SCENARIOS = Object.freeze(['human', 'scripted', 'idle']);
const COLLECTOR = new URL('../src/bot-detection/browser.js', import.meta.url);
const PAGE = '<!doctype html><meta charset="utf-8"><title>Visitor check</title><main>Fictional check page</main>';

/** A small hand-written patch set, not a full stealth library. It hides the three flags this harness tests. */
export const STEALTH_PATCH = `
Object.defineProperty(Navigator.prototype, 'webdriver', {get: () => undefined, configurable: true});
if (!window.chrome) window.chrome = {runtime: {}};
Object.defineProperty(navigator, 'languages', {get: () => ['en-CA', 'en']});
Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
`;

async function drive(page, scenario, ms) {
  if (scenario === 'idle') return page.waitForTimeout(ms);
  if (scenario === 'scripted') {
    // Untrusted events created by script at a fixed interval.
    return page.evaluate(duration => {
      const end = Date.now() + duration;
      const timer = setInterval(() => {
        document.dispatchEvent(new PointerEvent('pointermove', {clientX: 10, clientY: 10}));
        if (Date.now() > end) clearInterval(timer);
      }, 20);
    }, ms);
  }
  // Human-like: trusted mouse input from Playwright with random pauses and steps.
  const end = Date.now() + ms - 300;
  let x = 100, y = 100;
  while (Date.now() < end) {
    x = Math.min(600, Math.max(20, x + (Math.random() * 120 - 60)));
    y = Math.min(400, Math.max(20, y + (Math.random() * 120 - 60)));
    await page.mouse.move(x, y, {steps: 2 + Math.floor(Math.random() * 4)});
    await page.waitForTimeout(30 + Math.random() * 220);
  }
}

export async function runMatrix({modes = MODES, scenarios = SCENARIOS, sampleMs = 3000} = {}) {
  const source = await readFile(COLLECTOR, 'utf8');
  const results = [];
  for (const mode of modes) {
    const browser = await chromium.launch({headless: mode !== 'headed'});
    try {
      const version = browser.version();
      for (const scenario of scenarios) {
        const context = await browser.newContext(mode === 'stealth'
          ? {userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`}
          : {});
        let page;
        try {
          if (mode === 'stealth') await context.addInitScript(STEALTH_PATCH);
          page = await context.newPage();
          await page.setContent(PAGE);
          await page.addScriptTag({content: source});
          const pending = page.evaluate(ms => window.LifeOSBotSignals.collect({consent: true, sampleMs: ms}), sampleMs);
          await drive(page, scenario, sampleMs);
          const signals = await pending;
          results.push({mode, scenario, ...scoreSignals(signals), signals});
        } finally {
          await page?.close().catch(() => {});
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  return results;
}

/** Which rules fired in which mode. Rules that never fire are listed as negative results. */
export function summarise(results) {
  const byMode = {};
  for (const result of results) {
    byMode[result.mode] ??= {};
    for (const reason of result.reasons) byMode[result.mode][reason.signal] = (byMode[result.mode][reason.signal] ?? 0) + 1;
  }
  return byMode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runMatrix();
  await mkdir('test-results', {recursive: true});
  await writeFile('test-results/bot-harness.json', JSON.stringify({results, summary: summarise(results)}, null, 2));
  for (const result of results) {
    const rules = result.reasons.map(reason => reason.signal).join(', ') || '-';
    console.log(`${result.mode.padEnd(9)} ${result.scenario.padEnd(9)} ${result.verdict.padEnd(11)} score=${String(result.score).padStart(3)} rules: ${rules}`);
  }
}
