import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scoreSignals, VERDICTS, RULES} from '../src/bot-detection/score.mjs';

const human = {
  consent: true, webdriver: false, userAgentHeadless: false, chromium: true, pluginCount: 5, chromeObject: true,
  languageCount: 2, outerSizeZero: false, webglClass: 'hardware', canvasRepeatable: true,
  inputEvents: 40, untrustedRatio: 0, intervalCv: 0.6,
};
const scripted = {
  ...human, webdriver: true, userAgentHeadless: false, inputEvents: 30, untrustedRatio: 1, intervalCv: 0.01,
};
const headless = {
  ...human, webdriver: true, userAgentHeadless: true, pluginCount: 0, chromeObject: false, languageCount: 0,
  outerSizeZero: true, webglClass: 'software', canvasRepeatable: true, inputEvents: 0, untrustedRatio: null, intervalCv: null,
};

test('a normal browser with trusted, varied input is scored as human-like', () => {
  const result = scoreSignals(human);
  assert.equal(result.verdict, VERDICTS.HUMAN);
  assert.ok(result.score <= -3);
  assert.ok(result.reasons.some(reason => reason.signal === 'trusted-varied-input'));
});

test('scripted events and a flagged webdriver are scored as automated and explain why', () => {
  const result = scoreSignals(scripted);
  assert.equal(result.verdict, VERDICTS.AUTOMATED);
  const signals = result.reasons.map(reason => reason.signal);
  assert.ok(signals.includes('synthetic-events'));
  assert.ok(signals.includes('metronomic-input'));
  assert.ok(signals.includes('webdriver'));
  assert.ok(result.reasons.every(reason => typeof reason.detail === 'string' && reason.detail.length > 10));
});

test('a headless profile with many flags is automated', () => {
  const result = scoreSignals(headless);
  assert.equal(result.verdict, VERDICTS.AUTOMATED);
  assert.ok(result.reasons.some(reason => reason.signal === 'headless-user-agent'));
  assert.ok(result.reasons.some(reason => reason.signal === 'software-renderer'));
});

test('too few readable signals gives uncertain, not a guess', () => {
  const result = scoreSignals({consent: true, webdriver: null, userAgentHeadless: false, pluginCount: null, chromeObject: null, languageCount: null, outerSizeZero: null, webglClass: 'unknown', untrustedRatio: null, intervalCv: null, inputEvents: 0});
  assert.equal(result.verdict, VERDICTS.UNCERTAIN);
  assert.match(result.note, /Too few/);
});

test('conflicting evidence stays uncertain', () => {
  const mixed = {...human, webdriver: true, userAgentHeadless: false};
  const result = scoreSignals(mixed);
  assert.equal(result.verdict, VERDICTS.UNCERTAIN);
  assert.equal(result.score, 4 - 1 - 3, "webdriver (+4), plugins (-1) and varied trusted input (-3) cancel out");
});

test('without consent nothing is scored and no reasons are produced', () => {
  const result = scoreSignals({...scripted, consent: false});
  assert.equal(result.verdict, VERDICTS.UNCERTAIN);
  assert.deepEqual(result.reasons, []);
  assert.match(result.note, /No consent/);
});

test('missing signals never count as evidence', () => {
  const result = scoreSignals({consent: true, inputEvents: 40, untrustedRatio: null, intervalCv: null, webdriver: null, userAgentHeadless: null, pluginCount: null, chromeObject: null, languageCount: null, outerSizeZero: null, webglClass: 'unknown'});
  assert.equal(result.reasons.length, 0);
  assert.equal(result.verdict, VERDICTS.UNCERTAIN);
});

test('a rule that throws on odd input is skipped, not fatal', () => {
  const broken = {...human, webglClass: 42};
  assert.doesNotThrow(() => scoreSignals(broken));
  assert.throws(() => scoreSignals(null), TypeError);
});

test('every rule has a stable id and a non-empty explanation', () => {
  const ids = RULES.map(rule => rule.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(RULES.every(rule => rule.detail.length > 10 && Number.isInteger(rule.weight)));
});

test('unstable canvas output is one more reason to doubt the browser', () => {
  const result = scoreSignals({...human, canvasRepeatable: false});
  assert.ok(result.reasons.some(reason => reason.signal === 'unstable-canvas'));
});
