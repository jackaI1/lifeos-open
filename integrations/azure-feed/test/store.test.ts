import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPool} from '../src/store.ts';

test('a pool-level asynchronous failure does not crash the HTTP worker', async t => {
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: string) => warnings.push(message));
  process.env.SQL_SERVER = '127.0.0.1';
  process.env.SQL_DATABASE = 'fictional_test';
  const pool = createPool();
  try {
    assert.doesNotThrow(() => pool.emit('error', new Error('private connection details')));
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(warnings.join(' '), /private|details/);
  }
  finally {await pool.close();}
});
