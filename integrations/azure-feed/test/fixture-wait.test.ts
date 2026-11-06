import {test} from 'node:test';
import assert from 'node:assert/strict';
import {until} from './emulators.ts';

test('startup readiness stops immediately if interruption already happened', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(until(async () => {}, 'startup', [], 2000, controller.signal), /Interrupted/);
});

test('startup readiness observes interruption during a retry', async () => {
  await assert.rejects(until(async () => {throw new Error('Not ready');}, 'startup', [], 1000, AbortSignal.timeout(30)), /Interrupted/);
});
