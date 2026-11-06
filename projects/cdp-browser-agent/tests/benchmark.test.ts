import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ollamaPolicy, scriptedPolicy } from '../src/benchmark.js';

test('scripted policy stops after its three actions', async () => {
  assert.equal(await scriptedPolicy({ task: '', tree: [], step: 3 }), null);
});

test('model policy rejects unsuccessful HTTP responses', async () => {
  const policy = ollamaPolicy('unused', 'http://127.0.0.1:1');
  await assert.rejects(policy({ task: '', tree: [], step: 0 }));
});
