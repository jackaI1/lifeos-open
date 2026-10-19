import {httpsOrigin} from '../shared/service-config.mjs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store, hash } from '../server/store.mjs';
import { createAuth } from '../server/auth.mjs';
import { unprotect } from '../server/secrets.mjs';
import { runProcess, maintenanceEnvironment } from './process.mjs';
import { isInside, safeRelativePath, sha256, validateTargets, normalizedDeploymentTargets } from './policy.mjs';

const markerPath = '_lifeos-release.json';
const trustedFiles = ['src/gateway.mjs', 'src/public-notices.mjs', 'src/shared/service-config.mjs'];
const check = signal => { if (signal?.aborted) throw Object.assign(new Error('Deployment verification cancelled'), { code: 'cancelled' }); };
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function persist(path, value) {
  await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${randomUUID()}.tmp`, file = await open(temporary, 'wx');
  try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
}
async function files(root, prefix = '') {
  const found = []; for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Deployment refuses symbolic links');
    if (entry.isDirectory()) found.push(...await files(root, `${path}/`));
    else if (entry.isFile()) found.push(path); else throw new Error('Deployment refuses special files');
  } return found.sort();
}
async function boundedBytes(response, maximum = 4_000_000) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) { size += chunk.length; if (size > maximum) throw new Error('Deployment response exceeded its verification limit'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
function origin(value) {
  const parsed = new URL(value); if (parsed.protocol !== 'https:' || parsed.origin !== value || parsed.username || parsed.password) throw new Error('Expected an exact trusted HTTPS origin'); return parsed;
}
function secureHeaders(response) {
  const csp = response.headers.get('content-security-policy') ?? '';
  for (const directive of ["default-src 'self'", "script-src 'self'", "connect-src 'self'", "form-action 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) if (!csp.includes(directive)) throw new Error('Deployed response lacks its required content policy');
  if (/script-src[^;]*(?:unsafe-inline|unsafe-eval|\*)/.test(csp) || response.headers.get('cache-control') !== 'no-store') throw new Error('Deployed assets weakened the privacy response policy');
  for (const [name, allowed] of Object.entries({ 'script-src': ["'self'", 'https://accounts.google.com/gsi/client'], 'connect-src': ["'self'", 'https://accounts.google.com/gsi/'], 'form-action': ["'self'", 'https://accounts.google.com'] })) {
    const value = csp.split(';').map(part => part.trim()).find(part => part.startsWith(name + ' '));
    if (value.split(/\s+/).slice(1).some(source => !allowed.includes(source))) throw new Error('Deployed policy permits an unexpected external destination');
  }
}

export async function loadDeploymentBackend(target) {
  const config = await json(resolve(target.backendConfigFile));
  config.gatewaySecret = (await unprotect(config.gatewaySecretFile)).secret;
  return config;
}
export async function openDeploymentProbe(config) {
  const store = new Store(join(resolve(config.dataDir), 'lifeos.sqlite'));
  try {
    const auth = createAuth(store, config);
    const cookie = store.transaction(() => { const issued = auth.issue(config.allowedEmail), value = issued.cookie.split(';')[0], raw = value.slice(value.indexOf('=') + 1); store.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(Date.now() + 180000, hash(raw)); return value; });
    return { cookie, async revoke() { try { auth.logout({ headers: { cookie } }); } finally { store.close(); } } };
  } catch (error) { store.close(); throw error; }
}

/** Build only reviewed gateway code and protected deployment configuration. */
export async function stageTrustedGateway({stage,target,targets,readTrusted}) {
  targets=normalizedDeploymentTargets(targets);validateTargets(targets);
  const normalized=normalizedDeploymentTargets({[target.environment]:target})[target.environment];
  if(JSON.stringify(normalized)!==JSON.stringify(targets[target.environment]))throw new Error('Gateway stage target differs from trusted configuration');
  target=normalized;
  const rootWrangler=JSON.parse((await readTrusted('wrangler.jsonc')).toString()),selected=target.environment==='beta'?{...rootWrangler,...rootWrangler.env?.beta}:rootWrangler;
  if(selected.name!==target.deploymentTarget||httpsOrigin(selected.vars?.APP_ORIGIN)!==target.origin||httpsOrigin(selected.vars?.TUNNEL_ORIGIN)!==target.directOrigin||selected.vars?.ENVIRONMENT!==target.environment)throw new Error('Trusted Worker configuration differs from the explicit deployment target');
  const betaOrigin=targets.beta.origin;
  if(selected.vars?.BETA_ORIGIN&&httpsOrigin(selected.vars.BETA_ORIGIN)!==betaOrigin)throw new Error('Trusted beta destination differs from the isolated beta target');
  const workerHashes={};
  for(const path of trustedFiles){const bytes=await readTrusted(path);workerHashes[path]=sha256(bytes);await mkdir(dirname(join(stage,path)),{recursive:true});await writeFile(join(stage,path),bytes,{flag:'wx'});}
  const stageConfig={name:selected.name,main:'./src/gateway.mjs',compatibility_date:selected.compatibility_date,compatibility_flags:selected.compatibility_flags,workers_dev:false,preview_urls:false,assets:{directory:'./public',binding:'ASSETS',run_worker_first:true,not_found_handling:'single-page-application'},observability:{enabled:false},routes:[{pattern:new URL(target.origin).hostname,custom_domain:true}],vars:{APP_ORIGIN:target.origin,TUNNEL_ORIGIN:target.directOrigin,ENVIRONMENT:target.environment,BETA_ORIGIN:betaOrigin},...(selected.account_id?{account_id:selected.account_id}:{})};
  const configFile=join(stage,'wrangler.jsonc');await writeFile(configFile,JSON.stringify(stageConfig,null,2),{flag:'wx'});
  return {workerHashes,stageConfig,configFile};
}

/** Every input here comes from the trusted controller, never a candidate config or request body. */
export function createTrustedDeploymentHook(config, { fetchImpl = fetch, execute = runProcess, loadBackend = loadDeploymentBackend, openProbe = openDeploymentProbe, readTrustedFile } = {}) {
  config={...config,targets:normalizedDeploymentTargets(config.targets)};validateTargets(config.targets);
  if (!/^[a-f0-9]{40}$/.test(config.baseCommit ?? '')) throw new Error('Deployment needs a reviewed trusted base commit');
  const sourceRepo = resolve(config.sourceRepo), receiptRoot = resolve(config.deploymentRoot ?? join(sourceRepo, '.lifeos/controller-deployments'));
  const readTrusted = readTrustedFile ?? (async path => Buffer.from((await execute(config.gitExe ?? 'git', ['show', '--no-ext-diff', '--no-textconv', `${config.baseCommit}:${path}`], { cwd: sourceRepo, env: maintenanceEnvironment(), timeoutMs: 30000 })).stdout));
  return async ({ target, release, deploymentKey, signal, rollback = false, backupEvidence = null }) => {
    check(signal);
    if (JSON.stringify(target) !== JSON.stringify(config.targets[target?.environment])) throw new Error('Deployment target differs from trusted configuration');
    if (!/^[a-f0-9]{40}$/.test(release?.commit ?? '') || !/^beta-[a-f0-9]{16}$/.test(release?.releaseId ?? '') || typeof deploymentKey !== 'string' || deploymentKey.length > 300) throw new Error('Invalid tested deployment identity');
    if (release.tests?.suite?.status !== 'passed' || release.tests?.targeted?.status !== 'passed' || release.dataMigration !== 'none') throw new Error('Only a tested code-only release can deploy');
    origin(target.origin); origin(target.directOrigin);
    if (!Array.isArray(target.alternateOrigins) || !target.alternateOrigins.length) throw new Error('Explicit alternate Worker origins are required');
    for (const url of target.alternateOrigins) origin(url);
    const id = sha256(deploymentKey), directory = join(receiptRoot, id), statePath = join(directory, 'state.json');
    if (isInside(release.worktree, directory) || resolve(release.worktree) === directory) throw new Error('Deployment controller data cannot be inside the candidate');
    await mkdir(directory, { recursive: true });
    const prior = await json(statePath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (prior && (prior.commit !== release.commit || prior.environment !== target.environment || prior.deploymentKey !== deploymentKey)) throw new Error('Deployment key was already used for another release');
    const backend = await loadBackend(target), expectedData = await realpath(target.dataDir), actualData = await realpath(backend.dataDir);
    if (actualData.toLowerCase() !== expectedData.toLowerCase() || backend.environment !== target.environment || backend.origin !== target.origin || !Number.isInteger(backend.port) || !backend.gatewaySecret || !backend.allowedEmail) throw new Error('Trusted backend configuration does not match this deployment');
    if (target.environment === 'beta' && backend.integrationsEnabled !== false) throw new Error('Beta provider writes must be disabled');
    const otherTarget = config.targets[target.environment === 'beta' ? 'production' : 'beta'];
    if ((await realpath(otherTarget.dataDir)).toLowerCase() === actualData.toLowerCase()) throw new Error('Deployment data directories resolve to the same location');
    const otherBackend = await loadBackend(otherTarget);
    if (backend.gatewaySecret === otherBackend.gatewaySecret || backend.allowedEmail !== otherBackend.allowedEmail || otherBackend.environment !== otherTarget.environment || otherBackend.origin !== otherTarget.origin || (otherBackend.driveFolders?.archives ?? otherBackend.googleFolderIds?.archives) !== otherTarget.archiveRootId || (await realpath(otherBackend.dataDir)).toLowerCase() !== (await realpath(otherTarget.dataDir)).toLowerCase()) throw new Error('Actual backend credentials, owner or data isolation do not match the separate targets');
    if ((backend.driveFolders?.archives ?? backend.googleFolderIds?.archives) !== target.archiveRootId) throw new Error('Backend archive destination differs from the isolated target');
    const probe = await openProbe(backend), observations = [];
    const request = async (url, headers = {}) => {
      check(signal); return fetchImpl(url, { redirect: 'manual', headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    };
    const authenticated = async path => {
      const response = await request(target.origin + path, { cookie: probe.cookie });
      if (response.status !== 200) throw new Error('Authenticated deployment probe did not reach the private application');
      secureHeaders(response); return response;
    };
    async function verifyIsolation() {
      for (const path of ['/', '/app.js', '/api/health', '/api/uploads/maintenance-probe/0', `/${markerPath}`]) {
        const response = await request(target.origin + path, path === '/' ? { accept: 'text/html' } : {});
        if (![401, 303].includes(response.status)) throw new Error('An unauthenticated route did not fail closed');
        if (response.status === 303 && new URL(response.headers.get('location') ?? '', target.origin).href !== target.origin + '/auth/login') throw new Error('Unexpected unauthenticated redirect');
        await response.body?.cancel(); observations.push({ kind: 'unauthenticated', path, status: response.status });
      }
      for (const path of ['/', '/app.js', '/api/health', '/api/uploads/maintenance-probe/0']) {
        const response = await request(target.directOrigin + path); if (response.status !== 401) throw new Error('Direct origin did not deny the missing machine credential');
        await response.body?.cancel(); observations.push({ kind: 'direct-origin', path, status: response.status });
      }
      for (const alternate of target.alternateOrigins) {
        const response = await request(alternate + '/'); if (response.status !== 404) throw new Error('Alternate Worker hostname remains enabled');
        await response.body?.cancel(); observations.push({ kind: 'alternate-origin', origin: alternate, status: response.status });
      }
      const local = await request(`http://127.0.0.1:${backend.port}/api/health`, { cookie: probe.cookie, 'x-lifeos-gateway': backend.gatewaySecret, 'x-lifeos-origin': backend.origin });
      if (local.status !== 200) throw new Error('Trusted local backend health probe failed');
      const health = JSON.parse((await boundedBytes(local, 30000)).toString());
      if (health.status !== 'online' || health.environment !== target.environment || health.version !== backend.version) throw new Error('Local backend identity or version changed');
      const session = JSON.parse((await boundedBytes(await authenticated('/api/session'), 30000)).toString());
      if (session.email !== backend.allowedEmail || session.environment !== target.environment || session.version !== backend.version) throw new Error('Remote session reached a different backend');
    }
    try {
      const publicRoot = join(resolve(release.worktree), 'public'); if ((await lstat(publicRoot)).isSymbolicLink()) throw new Error('Candidate asset root is a symbolic link');
      const assetPaths = await files(publicRoot), expected = Object.keys(release.tree).filter(path => path.startsWith('public/')).map(path => path.slice(7)).sort();
      if (JSON.stringify(assetPaths) !== JSON.stringify(expected) || !assetPaths.includes('index.html') || !assetPaths.includes('app.js') || assetPaths.length > 500) throw new Error('Candidate asset set differs from its verified manifest');
      const assetBytes = new Map(); let total = 0;
      for (const path of assetPaths) {
        safeRelativePath(path); if (['_headers', '_redirects', markerPath].includes(path)) throw new Error('Candidate cannot define deployment routing or release metadata');
        const bytes = await readFile(join(publicRoot, path)); total += bytes.length;
        if (bytes.length > 4_000_000 || total > 64_000_000 || sha256(bytes) !== release.tree[`public/${path}`]) throw new Error('Candidate asset failed its release hash or size check');
        assetBytes.set(path, bytes);
      }
      const marker = { commit: release.commit, releaseId: release.releaseId, deploymentKeyHash: id, assetsSha256: sha256(JSON.stringify(assetPaths.map(path => [path, release.tree[`public/${path}`]]))) };
      const markerBytes = Buffer.from(JSON.stringify(marker));
      await verifyIsolation();
      let remoteMarker = null;
      const existing = await request(target.origin + '/' + markerPath, { cookie: probe.cookie });
      if (existing.status === 200) { try { remoteMarker = JSON.parse((await boundedBytes(existing, 30000)).toString()); } catch {} } else await existing.body?.cancel();
      if (JSON.stringify(remoteMarker) !== JSON.stringify(marker)) {
        if (prior?.status === 'verified') throw new Error('A previously verified deployment no longer matches the remote site; review before overwriting it');
        const stage = join(directory, `stage-${randomUUID().slice(0, 8)}`); await mkdir(join(stage, 'public'), { recursive: true }); await mkdir(join(stage, 'src'));
        for (const [path, bytes] of assetBytes) { await mkdir(dirname(join(stage, 'public', path)), { recursive: true }); await writeFile(join(stage, 'public', path), bytes, { flag: 'wx' }); }
        await writeFile(join(stage, 'public', markerPath), markerBytes, { flag: 'wx' });
        const {workerHashes,configFile}=await stageTrustedGateway({stage,target,targets:config.targets,readTrusted});
        await persist(statePath, { status: 'prepared', environment: target.environment, deploymentKey, commit: release.commit, stage, marker, trustedBaseCommit: config.baseCommit, workerHashes });
        const env = { ...maintenanceEnvironment(), CI: 'true', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' };
        const args = [join(sourceRepo, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--config', configFile, '--no-autoconfig', '--keep-vars', '--tag', release.commit.slice(0, 16), '--message', `LifeOS ${release.releaseId}`];
        await execute(process.execPath, [...args, '--dry-run'], { cwd: stage, env, signal, timeoutMs: 120000, maxBytes: 1_000_000 });
        check(signal);
        const deployed = await execute(process.execPath, args, { cwd: stage, env, signal, timeoutMs: 240000, maxBytes: 1_000_000 });
        const cloudflareVersionId = deployed.stdout.match(/Current Version ID:\s*([a-f0-9-]{36})/i)?.[1] ?? null;
        await persist(statePath, { status: 'uploaded-awaiting-verification', environment: target.environment, deploymentKey, commit: release.commit, stage, marker, trustedBaseCommit: config.baseCommit, workerHashes, cloudflareVersionId });
      }
      await verifyIsolation();
      const observedMarker = await boundedBytes(await authenticated('/' + markerPath), 30000);
      if (sha256(observedMarker) !== sha256(markerBytes)) throw new Error('Deployed commit marker does not match the tested release');
      for (const [path, bytes] of assetBytes) {
        const route = path === 'index.html' ? '/' : '/' + path.split('/').map(encodeURIComponent).join('/');
        if (sha256(await boundedBytes(await authenticated(route))) !== sha256(bytes)) throw new Error('A deployed asset differs from its tested content');
      }
      const saved = await json(statePath).catch(() => ({}));
      const receipt = { environment: target.environment, commit: release.commit, origin: target.origin, deploymentId: `assets-${sha256(markerBytes)}`, cloudflareVersionId: saved.cloudflareVersionId ?? null, healthy: true, authenticationVerified: true, authenticationMethod: 'short-lived-machine-probe-session', actualGoogleBrowserLoginTested: false, dataIsolated: true, backendVersion: backend.version, trustedBaseCommit: config.baseCommit, assetCount: assetBytes.size, assetManifestSha256: marker.assetsSha256, verifiedAt: new Date().toISOString(), observations, rollback, backupId: backupEvidence?.backupId ?? null };
      await persist(statePath, { ...saved, status: 'verified', environment: target.environment, deploymentKey, commit: release.commit, marker, receipt });
      return receipt;
    } finally { await probe.revoke(); }
  };
}
