import assert from 'node:assert/strict';
import {writeFile, mkdir} from 'node:fs/promises';
import {setTimeout} from 'node:timers/promises';
import {jenkinsClient} from './jenkins-lint.mjs';

const request = await jenkinsClient({
  url: process.env.JENKINS_URL,
  user: 'admin', token: process.env.JENKINS_ADMIN_PASSWORD,
});
async function json(path) {
  const response = await request(path);
  assert.equal(response.status, 200, `Jenkins API ${path}`);
  return response.json();
}
const started = await request('job/lifeos-open/build', {method: 'POST'});
assert.equal(started.status, 201, 'the JCasC-created job accepts a build');
const deadline = Date.now() + 20 * 60_000;
let build;
while (Date.now() < deadline) {
  const response = await request('job/lifeos-open/1/api/json');
  if (response.ok) {
    build = await response.json();
    if (!build.building) break;
  } else {
    assert.equal(response.status, 404, 'only an unstarted build may be missing');
  }
  await setTimeout(5_000);
}
await mkdir('test-results/jenkins', {recursive: true});
await writeFile('test-results/jenkins/build.json', JSON.stringify(build || {}, null, 2));
if (build?.result !== 'SUCCESS') {
  const response = await request('job/lifeos-open/1/consoleText');
  const decoder = new TextDecoder();
  let tail = '';
  for await (const chunk of response.body) tail = (tail + decoder.decode(chunk, {stream: true})).slice(-12_000);
  tail = (tail + decoder.decode()).slice(-12_000);
  console.error(tail.replaceAll(process.env.JENKINS_ADMIN_PASSWORD, '[redacted]'));
}
assert.equal(build?.result, 'SUCCESS', 'the real SCM pipeline succeeds');
const reports = await json('job/lifeos-open/1/testReport/api/json');
await writeFile('test-results/jenkins/test-report.json', JSON.stringify(reports, null, 2));
assert.equal(reports.failCount, 0);
// TestResult exports these three counts; totalCount belongs to TestResultAction.
const totalCount = reports.passCount + reports.failCount + reports.skipCount;
assert.ok(totalCount > 19, 'both Node and React reports were collected');
for (const artifact of ['test-results/node.xml', 'test-results/react.xml', 'test-results/privacy.json', 'test-results/image-id.txt']) {
  assert.ok(build.artifacts.some(item => item.relativePath === artifact), `archived ${artifact}`);
  const response = await request(`job/lifeos-open/1/artifact/${artifact}`);
  assert.equal(response.status, 200);
  await writeFile(`test-results/jenkins/${artifact.split('/').at(-1)}`, await response.text());
}
const revisions = build.actions.flatMap(action => Object.values(action.buildsByBranchName || {}));
assert.ok(revisions.some(revision => revision.revision?.SHA1 === process.env.LIFEOS_JENKINS_REF), 'SCM checked out the requested commit');
console.log(`Jenkins SCM build #1: SUCCESS; ${totalCount} tests; 4 archived reports; requested commit verified.`);
