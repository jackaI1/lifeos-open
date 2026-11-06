import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';

test('the Linux release includes every local module needed by the build script', async () => {
  const paths = execFileSync('bash', ['-c', 'source deploy/linux/common.sh; printf "%s\\n" "${LIFEOS_RELEASE_PATHS[@]}"'], {encoding: 'utf8'}).trim().split('\n');
  const result = await build({entryPoints: ['tools/build.mjs'], bundle: true, platform: 'node', target: 'node24', format: 'esm', packages: 'external', write: false, metafile: true});
  for (const input of Object.keys(result.metafile.inputs)) {
    assert.ok(paths.some(path => input === path || input.startsWith(path + '/')), `Linux release is missing build input ${input}`);
  }
});
