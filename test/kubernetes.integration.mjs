import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {parseAllDocuments, stringify} from 'yaml';

const render = (path) => execFileSync('kubectl', ['kustomize', path], {encoding:'utf8', maxBuffer:1024*1024});
const validate = (input) => spawnSync('kubeconform', ['-strict', '-summary', '-output', 'json', '-kubernetes-version', '1.35.0'], {input, encoding:'utf8', maxBuffer:1024*1024});

for (const target of ['base', 'overlays/kind', 'overlays/ci']) {
 test(`${target}: rendered resources pass strict Kubernetes schema validation`, () => {
  const result = validate(render(`deploy/kubernetes/${target}`));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.valid, 5);
  assert.equal(report.summary.skipped, 0);
  assert.equal(report.summary.invalid, 0);
 });
}

test('schema validator rejects an unknown Deployment field', () => {
 const docs = parseAllDocuments(render('deploy/kubernetes/base')).map(doc => doc.toJS());
 const deployment = docs.find(doc => doc.kind === 'Deployment');
 deployment.spec.invalidRolloutField = true;
 const result = validate(stringify(deployment));
 assert.equal(result.status, 1, result.stdout + result.stderr);
 assert.equal(JSON.parse(result.stdout).summary.invalid, 1);
});

test('rendered workload connects storage, settings, service and loopback health checks', () => {
 const docs = parseAllDocuments(render('deploy/kubernetes/overlays/kind')).map(doc => doc.toJS());
 const get = kind => docs.find(doc => doc.kind === kind);
 const deployment = get('Deployment'), pod = deployment.spec.template.spec, container = pod.containers[0];
 const pvc = get('PersistentVolumeClaim'), service = get('Service'), config = get('ConfigMap');
 assert.equal(deployment.spec.replicas, 1, 'SQLite must have one app writer');
 assert.equal(deployment.spec.strategy.type, 'Recreate', 'updates must stop the old SQLite writer first');
 assert.deepEqual(pvc.spec.accessModes, ['ReadWriteOnce']);
 assert.equal(pvc.spec.storageClassName, 'standard');
 assert.equal(pod.volumes[0].persistentVolumeClaim.claimName, pvc.metadata.name);
 assert.equal(container.volumeMounts[0].name, pod.volumes[0].name);
 assert.equal(config.data.LIFEOS_DATABASE, `${container.volumeMounts[0].mountPath}/workspace.sqlite`);
 assert.equal(container.envFrom[0].configMapRef.name, config.metadata.name);
 assert.equal(config.data.APP_ORIGIN, 'http://127.0.0.1:8787');
 assert.equal(config.data.LIFEOS_BIND_HOST, '0.0.0.0');
 assert.equal(config.data.AUTH_MODE, 'demo');
 assert.equal(service.spec.type, 'ClusterIP', 'access stays through a local tunnel');
 for (const [key, value] of Object.entries(service.spec.selector)) assert.equal(deployment.spec.template.metadata.labels[key], value);
 assert.equal(service.spec.ports[0].targetPort, container.ports[0].name);
 for (const name of ['startupProbe', 'readinessProbe', 'livenessProbe']) {
  assert.equal(container[name].httpGet.path, '/api/health');
  assert.equal(container[name].httpGet.port, container.ports[0].name);
  assert.deepEqual(container[name].httpGet.httpHeaders, [{name:'Host', value:'127.0.0.1:8787'}]);
 }
 assert.equal(pod.securityContext.fsGroup, 1000, 'the non-root process must be able to write its volume');
 assert.equal(pod.securityContext.runAsUser, 1000);
 assert.equal(pod.automountServiceAccountToken, false);
 assert.equal(container.securityContext.readOnlyRootFilesystem, true);
 assert.equal(container.securityContext.allowPrivilegeEscalation, false);
 assert.deepEqual(container.securityContext.capabilities.drop, ['ALL']);
 for (const resource of ['cpu', 'memory']) {
  assert.ok(container.resources.requests[resource]);
  assert.ok(container.resources.limits[resource]);
 }
});


test('CI overlay pulls from the registry with a separately created credential', () => {
 const docs = parseAllDocuments(render('deploy/kubernetes/overlays/ci')).map(doc => doc.toJS());
 const pod = docs.find(doc => doc.kind === 'Deployment').spec.template.spec;
 assert.equal(pod.containers[0].imagePullPolicy, 'Always');
 assert.deepEqual(pod.imagePullSecrets, [{name:'ghcr-pull'}]);
 assert.equal(docs.some(doc => doc.kind === 'Secret'), false, 'credentials must be supplied at runtime');
});

test('cluster smoke command refuses non-kind contexts and mutable images before deployment', () => {
 for (const args of [['production', 'invalid'], ['kind-lifeos', 'ghcr.io/jackai1/lifeos-open:main']]) {
  const result = spawnSync('bash', ['deploy/kubernetes/smoke.sh', ...args], {encoding:'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing|immutable/);
 }
});

test('image override preserves all resources and uses an immutable registry digest', () => {
 const image = 'ghcr.io/jackai1/lifeos-open@sha256:' + 'a'.repeat(64);
 const output = execFileSync(process.execPath, ['tools/kubernetes-render.mjs', 'ci', image], {encoding:'utf8'});
 const docs = parseAllDocuments(output).map(doc => doc.toJS());
 assert.deepEqual(docs.map(doc => doc.kind).sort(), ['ConfigMap', 'Deployment', 'Namespace', 'PersistentVolumeClaim', 'Service']);
 assert.equal(docs.find(doc => doc.kind === 'Deployment').spec.template.spec.containers[0].image, image);
 const local = execFileSync(process.execPath, ['tools/kubernetes-render.mjs', 'kind', 'lifeos-open:upgrade-1'], {encoding:'utf8'});
 const pod = parseAllDocuments(local).map(doc => doc.toJS()).find(doc => doc.kind === 'Deployment').spec.template.spec;
 assert.equal(pod.containers[0].image, 'lifeos-open:upgrade-1');
 assert.equal(pod.containers[0].imagePullPolicy, 'IfNotPresent');
 const result = validate(output);
 assert.equal(result.status, 0, result.stdout + result.stderr);
});
