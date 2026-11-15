import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import YAML from 'yaml';
import {createDemoServer} from '../src/hosted/server.mjs';

const run = promisify(execFile);
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the rendered service keeps the health probes, the port and the secret reference', async () => {
  const template = await read('deploy/cloud-run/service.template.yaml');
  const rendered = template
    .replaceAll('__SERVICE__', 'lifeos-demo')
    .replaceAll('__IMAGE__', 'northamerica-northeast1-docker.pkg.dev/example-project/lifeos/lifeos-demo:v0.0.0-test')
    .replaceAll('__PARENT_ORIGIN_SECRET__', 'lifeos-demo-parent-origin');
  assert.doesNotMatch(rendered, /__[A-Z_]+__/);
  const service = YAML.parse(rendered);
  const container = service.spec.template.spec.containers[0];
  assert.equal(container.ports[0].containerPort, 8080);
  assert.equal(container.startupProbe.httpGet.path, '/healthz');
  assert.equal(container.livenessProbe.httpGet.path, '/healthz');
  const parent = container.env.find(item => item.name === 'PARENT_ORIGIN');
  assert.deepEqual(parent.valueFrom.secretKeyRef, {name: 'lifeos-demo-parent-origin', key: 'latest'});
  assert.equal(parent.value, undefined, 'PARENT_ORIGIN must come from Secret Manager, not a literal value');
  assert.ok(Number(service.spec.template.metadata.annotations['autoscaling.knative.dev/maxScale']) <= 2);
});

test('deploy.sh and smoke.sh parse, and deploy.sh refuses to run without its settings', async () => {
  for (const script of ['deploy/cloud-run/deploy.sh', 'deploy/cloud-run/smoke.sh']) {
    await run('bash', ['-n', new URL(`../${script}`, import.meta.url).pathname]);
  }
  const env = {...process.env};
  for (const key of ['GCP_PROJECT_ID', 'GCP_REGION', 'ARTIFACT_REPOSITORY', 'PARENT_ORIGIN_SECRET']) delete env[key];
  await assert.rejects(run('bash', [new URL('../deploy/cloud-run/deploy.sh', import.meta.url).pathname, 'revisions'], {env}), err => /Set GCP_PROJECT_ID first/.test(err.stderr) || /gcloud/.test(err.stderr));
});

test('the workflow tests the image before any deploy and deploys only from a version tag', async () => {
  const workflow = YAML.parse(await read('.github/workflows/cloud-run.yml'));
  assert.deepEqual(workflow.jobs.deploy.needs, 'test');
  assert.match(workflow.jobs.deploy.if, /refs\/tags\/v/);
  assert.equal(workflow.jobs.deploy.permissions['id-token'], 'write');
  const text = await read('.github/workflows/cloud-run.yml');
  assert.doesNotMatch(text, /credentials_json|GOOGLE_APPLICATION_CREDENTIALS|service_account_key/);
  const deployStep = workflow.jobs.deploy.steps.find(step => step.uses?.startsWith('google-github-actions/auth'));
  assert.ok(deployStep.with.workload_identity_provider.includes('vars.'));
});

test('the health route answers on the public host and the API stays closed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lifeos-healthz-'));
  await writeFile(join(directory, 'index.html'), '<!doctype html><html><body>demo</body></html>');
  const server = createDemoServer({directory, parentOrigin: 'https://owner.example.invalid'});
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => {
    await new Promise(done => server.close(done));
    await rm(directory, {recursive: true, force: true});
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {status: 'ok', mode: 'browser-only'});
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.notEqual((await fetch(`${base}/api/health`)).status, 200);
});
