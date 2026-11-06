import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('failed Jenkins startup still tears down when log retrieval fails and the password contains regex characters', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jenkins-cleanup-'));
  try {
    // Fake only the unavailable Docker boundary. Exercise the real shell trap.
    await writeFile(join(dir, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CLEANUP_CALLS, JSON.stringify(args) + '\\n');
if (args.includes('logs')) {
  console.log('startup error: ' + process.env.JENKINS_ADMIN_PASSWORD);
  process.exit(1);
}
if (args.includes('up') || args.includes('inspect')) process.exit(1);
`, {mode: 0o755});
    const password = 'fictional/password[with]$characters';
    const run = spawnSync('bash', ['deploy/jenkins/test.sh'], {
      encoding: 'utf8', timeout: 10_000,
      env: {...process.env, PATH: `${dir}:${process.env.PATH}`, CLEANUP_CALLS: join(dir, 'calls'),
        JENKINS_ADMIN_PASSWORD: password, JENKINS_DOCKER_GID: '0', LIFEOS_JENKINS_REF: 'fictional-commit'},
    });
    assert.equal(run.status, 1);
    const calls = (await readFile(join(dir, 'calls'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(calls.some(args => args.includes('down') && args.includes('--volumes')), 'teardown attempted after failed diagnostics');
    assert.match(run.stdout, /Cleanup verified/);
    assert.ok(!(run.stdout + run.stderr).includes(password), 'diagnostics never echo the password');
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
