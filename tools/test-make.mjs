import {spawnSync} from 'node:child_process';
import {statSync,utimesSync,unlinkSync} from 'node:fs';
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

// The server bundle imports authored public modules too. A public input must
// invalidate the build, while generated vendor bundles must not cause a loop.
const input='public/voice.css', original=statSync(input);
try {
 // macOS's bundled Make 3.81 compares whole-second timestamps.
 await new Promise(resolve=>setTimeout(resolve,Math.ceil(Date.now()/1000)*1000+20-Date.now()));
 utimesSync(input,original.atime,new Date());
 make('build');
 assert.ok(statSync('build/.make-build-stamp').mtimeMs>before,'changed public source must rebuild');
} finally {utimesSync(input,original.atime,original.mtime);}
unlinkSync('build/server.mjs');
make('build');
assert.ok(statSync('build/server.mjs').size>0,'missing output must rebuild');
console.log('Changed public inputs and missing outputs also rebuild.');
