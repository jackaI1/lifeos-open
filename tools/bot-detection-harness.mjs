// Runs real Chromium through Playwright against the visitor check page and records which
// signals fire in each mode. Headed mode needs a display (CI uses xvfb-run on Linux).
// Every browser, page and server is closed in a finally block.
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {extname, dirname, join, normalize, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

export const MODES = Object.freeze(['headed', 'headless', 'stealth']);
export const INTERACTIONS = Object.freeze(['none', 'trusted-regular', 'scripted']);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const types = {'.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8'};

// The stealth mode hides the single most common automation flag and reports the
// browser version without the HeadlessChrome token. It is a small patch set, not a full stealth library.
const STEALTH_INIT = "Object.defineProperty(Navigator.prototype,'webdriver',{get:()=>undefined,configurable:true});";

export const sleep = ms => new Promise(done => setTimeout(done, ms));

export function launchOptions(mode) {
  if (mode === 'headed') return {headless: false};
  if (mode === 'headless') return {headless: true};
  if (mode === 'stealth') return {headless: true, args: ['--disable-blink-features=AutomationControlled']};
  throw Error(`Unknown mode ${mode}`);
}

async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const target = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
      if (!target.startsWith(root + sep) || !path.startsWith('/bot-check/')) throw Error('not found');
      const body = await readFile(target);
      response.writeHead(200, {'content-type': types[extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store'});
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return {server, origin: `http://127.0.0.1:${server.address().port}`};
}

async function drive(page, interaction) {
  if (interaction === 'none') return;
  if (interaction === 'trusted-regular') {
    // Playwright's mouse produces trusted input events at a steady pace.
    for (let step = 0; step < 24; step++) {
      await page.mouse.move(100 + step * 8, 200);
      await sleep(60);
    }
    return;
  }
  if (interaction === 'scripted') {
    // Synthetic events created by page script are untrusted.
    await page.evaluate(() => new Promise(done => {
      let step = 0;
      const timer = setInterval(() => {
        document.dispatchEvent(new MouseEvent('pointermove', {clientX: 10 + step, clientY: 10}));
        if (++step === 24) {
          clearInterval(timer);
          done();
        }
      }, 60);
    }));
    return;
  }
  throw Error(`Unknown interaction ${interaction}`);
}

async function runOne(browser, mode, interaction, origin, observeMs) {
  const version = await browser.version();
  const userAgent = mode === 'stealth' ? `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36` : undefined;
  const context = await browser.newContext({userAgent, viewport: {width: 1000, height: 700}});
  let page;
  try {
    page = await context.newPage();
    if (mode === 'stealth') await page.addInitScript(STEALTH_INIT);
    await page.goto(`${origin}/bot-check/`, {waitUntil: 'load'});
    const check = page.evaluate(async ms => {
      const signals = await window.lifeosBotCheck.collect({consent: true, observeMs: ms});
      return window.lifeosBotCheck.score(signals);
    }, observeMs);
    await drive(page, interaction);
    const result = await check;
    return {
      mode,
      interaction,
      verdict: result.verdict,
      firedWeight: result.firedWeight,
      fired: result.reasons.filter(r => r.status === 'fired').map(r => r.id),
      unavailable: result.reasons.filter(r => r.status === 'unavailable').map(r => r.id),
      reasons: result.reasons.map(({id, status, detail}) => ({id, status, detail})),
    };
  } finally {
    await page?.close().catch(() => {});
    await context.close();
  }
}

/** Run every mode and interaction. Returns one row per combination. */
export async function runHarness({modes = MODES, interactions = INTERACTIONS, observeMs = 2500, outputPath} = {}) {
  if (modes.includes('headed') && process.platform === 'linux' && !process.env.DISPLAY) throw Error('Headed mode needs a display; run under xvfb-run.');
  const {server, origin} = await startServer();
  const rows = [];
  try {
    for (const mode of modes) {
      const browser = await chromium.launch(launchOptions(mode));
      try {
        for (const interaction of interactions) rows.push(await runOne(browser, mode, interaction, origin, observeMs));
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise(done => server.close(done));
  }
  if (outputPath) {
    await mkdir(dirname(outputPath), {recursive: true});
    await writeFile(outputPath, JSON.stringify({generatedBy: 'tools/bot-detection-harness.mjs', rows}, null, 2) + '\n');
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outputPath = resolve(process.env.BOT_HARNESS_OUTPUT ?? 'test-results/bot-detection.json');
  const rows = await runHarness({outputPath});
  for (const row of rows) console.log(`${row.mode.padEnd(9)} ${row.interaction.padEnd(16)} ${row.verdict.padEnd(10)} fired=${row.fired.join(',') || '-'}`);
}
