// Drives real Chromium through Playwright. It runs only when LIFEOS_BOT_HARNESS=1 is set,
// because headed mode opens a browser window. CI sets it under xvfb-run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runHarness, MODES, INTERACTIONS} from '../tools/bot-detection-harness.mjs';

const enabled = process.env.LIFEOS_BOT_HARNESS === '1';

test('harness records verdicts for headed, headless and stealth Chromium', {skip: !enabled && 'set LIFEOS_BOT_HARNESS=1', timeout: 280000}, async () => {
  const rows = await runHarness({outputPath: 'test-results/bot-detection.json'});
  assert.equal(rows.length, MODES.length * INTERACTIONS.length);
  const byKey = Object.fromEntries(rows.map(row => [`${row.mode}/${row.interaction}`, row]));
  for (const row of rows) assert.ok(['automated', 'human', 'uncertain'].includes(row.verdict), `${row.mode}/${row.interaction}`);
  // Input created by page script is untrusted in every mode.
  for (const mode of MODES) assert.ok(byKey[`${mode}/scripted`].fired.includes('untrusted-input'), mode);
  // Trusted input from Playwright is not reported as untrusted.
  for (const mode of MODES) assert.ok(!byKey[`${mode}/trusted-regular`].fired.includes('untrusted-input'), mode);
  // Playwright sets navigator.webdriver; the stealth patch hides it.
  for (const mode of ['headed', 'headless']) assert.ok(byKey[`${mode}/none`].fired.includes('webdriver-flag'), mode);
  assert.ok(!byKey['stealth/none'].fired.includes('webdriver-flag'));
  // Headless Chromium says so in its user agent; the stealth UA does not.
  assert.ok(byKey['headless/none'].fired.includes('headless-user-agent'));
  assert.ok(!byKey['stealth/none'].fired.includes('headless-user-agent'));
  // Without observed input a check can never say "human".
  for (const mode of MODES) assert.notEqual(byKey[`${mode}/none`].verdict, 'human', mode);
});
