import {spawnSync} from 'node:child_process';
import {statSync} from 'node:fs';
import assert from 'node:assert/strict';

function make(target) {
  const result = spawnSync('make', [target], {stdio: 'inherit'});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `make ${target} failed`);
}

make('test');
make('build');
const before = statSync('build/.make-build-stamp').mtimeMs;
make('build');
assert.equal(statSync('build/.make-build-stamp').mtimeMs, before, 'unchanged build should be skipped');
console.log('Make test passed and the unchanged build was skipped.');
