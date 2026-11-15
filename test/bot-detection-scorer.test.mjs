import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scoreSignals, summarizeInput, RULES} from '../public/bot-check/scorer.mjs';
import {collectSignals} from '../public/bot-check/signals.mjs';

const human = {
  webdriver: false, userAgent: 'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36', plugins: 5, languages: 2,
  outerWidth: 1280, outerHeight: 800, webglRenderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)', canvasWorks: true,
  automationMarkers: [], input: {count: 40, untrusted: 0, intervals: 30, intervalStdevMs: 14.2},
};
const headless = {...human, userAgent: 'Mozilla/5.0 HeadlessChrome/131.0.0.0 Safari/537.36', plugins: 0, webdriver: true, webglRenderer: 'Google SwiftShader'};

test('a real-looking visitor with observed human input is human', () => {
  const result = scoreSignals(human);
  assert.equal(result.verdict, 'human');
  assert.equal(result.firedWeight, 0);
  assert.equal(result.reasons.length, RULES.length);
});

test('headless automation with script-created input is automated, with reasons', () => {
  const result = scoreSignals({...headless, input: {count: 24, untrusted: 24, intervals: 23, intervalStdevMs: 0.2}});
  assert.equal(result.verdict, 'automated');
  const fired = result.reasons.filter(r => r.status === 'fired').map(r => r.id);
  assert.deepEqual(fired.sort(), ['headless-user-agent', 'regular-input-timing', 'software-renderer', 'untrusted-input', 'webdriver-flag'].sort());
  const spoofed = scoreSignals({...human, plugins: 0, webdriver: false});
  assert.equal(spoofed.reasons.find(r => r.id === 'no-plugins-chrome-ua').status, 'fired');
});

test('without observed input the verdict is uncertain, never human', () => {
  const result = scoreSignals({...human, input: null});
  assert.equal(result.verdict, 'uncertain');
  assert.equal(result.reasons.find(r => r.id === 'untrusted-input').status, 'unavailable');
});

test('weak evidence alone is uncertain, not a guess', () => {
  const result = scoreSignals({...human, outerWidth: 0});
  assert.equal(result.verdict, 'uncertain');
  assert.equal(result.firedWeight, 1);
});

test('missing signals are unavailable, not clear', () => {
  const result = scoreSignals({});
  assert.equal(result.verdict, 'uncertain');
  assert.ok(result.reasons.every(r => r.status === 'unavailable'));
  assert.equal(result.availableWeight, 0);
});

test('regular timing needs enough intervals before it can fire', () => {
  const few = scoreSignals({...human, input: {count: 5, untrusted: 0, intervals: 4, intervalStdevMs: 0}});
  assert.equal(few.reasons.find(r => r.id === 'regular-input-timing').status, 'unavailable');
  const many = scoreSignals({...human, input: {count: 20, untrusted: 0, intervals: 19, intervalStdevMs: 0.5}});
  assert.equal(many.reasons.find(r => r.id === 'regular-input-timing').status, 'fired');
});

test('summarizeInput separates trusted and script-created events and measures spacing', () => {
  const events = [0, 50, 100, 150, 200, 250, 300, 350, 400].map(t => ({type: 'pointermove', trusted: true, t}));
  events.push({type: 'keydown', trusted: false, t: 10});
  const summary = summarizeInput(events);
  assert.equal(summary.count, 10);
  assert.equal(summary.untrusted, 1);
  assert.equal(summary.intervals, 8);
  assert.equal(summary.intervalStdevMs, 0);
});

test('collector reads nothing without consent', async () => {
  const touched = [];
  const trap = new Proxy({}, {get(_target, key) { touched.push(String(key)); return undefined; }});
  const result = await collectSignals({consent: false, win: trap, doc: trap, nav: trap});
  assert.deepEqual(result, {consented: false});
  assert.deepEqual(touched, []);
});

test('collector with consent reads signals from a fake page and forgets them', async () => {
  const listeners = new Map();
  const doc = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: type => listeners.delete(type),
    createElement: () => ({getContext: () => null}),
    keys: [],
  };
  const win = {
    outerWidth: 900, outerHeight: 700, performance: {now: () => 0},
    setTimeout: fn => { queueMicrotask(fn); return 0; },
  };
  const nav = {webdriver: undefined, userAgent: 'Mozilla/5.0 Chrome/131.0', plugins: [1, 2, 3], languages: ['en-CA']};
  const result = await collectSignals({consent: true, observeMs: 1, win, doc, nav});
  assert.equal(result.consented, true);
  assert.equal(result.webdriver, false);
  assert.equal(result.plugins, 3);
  assert.equal(result.webglRenderer, null);
  assert.equal(result.canvasWorks, false);
  assert.equal(result.input.count, 0);
  assert.equal(listeners.size, 0);
});

test('the check stores nothing and sends nothing', async () => {
  for (const file of ['scorer.mjs', 'signals.mjs', 'page.mjs']) {
    const source = await readFile(new URL(`../public/bot-check/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|sendBeacon|XMLHttpRequest|WebSocket|navigator\.storage/, file);
  }
});
