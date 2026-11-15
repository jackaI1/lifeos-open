// Drives real Chromium through Playwright. It needs browsers and, for headed mode, a
// display, so it runs only when LIFEOS_BOT_HARNESS=1 (see .github/workflows/bot-detection.yml).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runMatrix} from '../tools/bot-harness.mjs';

const enabled = process.env.LIFEOS_BOT_HARNESS === '1';
const options = {skip: !enabled, timeout: 600_000};
const fired = (result, signal) => result.reasons.some(reason => reason.signal === signal);

test('untrusted scripted pointer events are caught in every mode', options, async () => {
  const results = await runMatrix({scenarios: ['scripted'], sampleMs: 2500});
  assert.equal(results.length, 3);
  for (const result of results) {
    assert.equal(result.verdict, 'automated', `${result.mode} should be automated`);
    assert.ok(fired(result, 'synthetic-events'), `${result.mode} should show synthetic events`);
  }
});

test('a headed human-like session is not called automated (false-positive check)', options, async () => {
  const [result] = await runMatrix({modes: ['headed'], scenarios: ['human'], sampleMs: 4000});
  assert.notEqual(result.verdict, 'automated', JSON.stringify(result.reasons));
  assert.ok(result.observed >= 4);
});

test('headless Chromium shows its own flags, which the stealth patch hides', options, async () => {
  const [headless, stealth] = await runMatrix({modes: ['headless', 'stealth'], scenarios: ['idle'], sampleMs: 1500});
  assert.ok(fired(headless, 'webdriver') || fired(headless, 'headless-user-agent'), 'headless should show a flag');
  assert.equal(fired(stealth, 'webdriver'), false, 'the patch hides navigator.webdriver');
  assert.equal(fired(stealth, 'headless-user-agent'), false, 'the patch removes HeadlessChrome from the user agent');
});

test('without enough input the harness says uncertain instead of human-like', options, async () => {
  const results = await runMatrix({modes: ['headed', 'headless', 'stealth'], scenarios: ['idle'], sampleMs: 1500});
  for (const result of results) assert.notEqual(result.verdict, 'human-like', result.mode);
});
