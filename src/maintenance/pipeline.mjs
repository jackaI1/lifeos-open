import { cp, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { allowedChange, isInside, policyFingerprint, safeRelativePath, scanContent, sha256, validateIntent, validateTargets, normalizedDeploymentTargets } from './policy.mjs';
import { runProcess, maintenanceEnvironment } from './process.mjs';
import { verifyControllerTests } from './controller-tests.mjs';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
async function durableJson(path, value, exclusive = false) {
  await mkdir(dirname(path), { recursive: true });
  const temp = exclusive ? path : `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx'); try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); } finally { await file.close(); }
  if (!exclusive) await rename(temp, path);
}
async function walk(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (['.git', 'node_modules', 'tmp'].includes(entry.name) && !prefix) continue;
    const path = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error('Candidate symbolic links are not allowed');
    if (entry.isDirectory()) files.push(...await walk(root, `${path}/`)); else if (entry.isFile()) files.push(path); else throw new Error('Candidate special files are not allowed');
  }
  return files.sort();
}
async function snapshot(root) {
  const result = {};
  for (const path of await walk(root)) { const bytes = await readFile(join(root, path)); if (bytes.length > 4_000_000) throw new Error('Candidate file exceeds inspection limit'); result[path] = sha256(bytes); }
  return result;
}
async function assertNoLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Dependency cache contains a symbolic link');
    if (entry.isDirectory()) await assertNoLinks(join(directory, entry.name));
  }
}
const changes = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]).sort();

export class MaintenancePipeline {
  constructor(config, { runAI, runSandbox, deploy, verifyController = verifyControllerTests, clock = () => new Date().toISOString() } = {}) {
    this.config = {...config,targets:normalizedDeploymentTargets(config.targets)}; this.root = resolve(config.root); this.repo = join(this.root, 'repository.git'); this.statePath = join(this.root, 'state.json');
    Object.assign(this, { runAI, runSandbox, deploy, verifyController, clock });
    if (!/^[a-f0-9]{40}$/.test(config.baseCommit ?? '')) throw new Error('Maintenance requires a reviewed full base commit');
    if (config.maxAttempts !== undefined && (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1 || config.maxAttempts > 3)) throw new Error('Maintenance attempts must be bounded from one to three');
    if (resolve(config.sourceRepo) === this.root || isInside(this.root, config.sourceRepo)) throw new Error('Maintenance cannot contain the production checkout');
  }
  async git(args, cwd = this.repo) {
    return (await runProcess(this.config.gitExe ?? 'git', ['-c', 'core.longpaths=true', '-c', `core.hooksPath=${join(this.root, 'empty-hooks')}`, '-c', 'credential.helper=', '-c', 'protocol.file.allow=always', ...args], { cwd, env: maintenanceEnvironment(), timeoutMs: 120000 })).stdout.trim();
  }
  async withLock(fn) {
    await mkdir(this.root, { recursive: true }); const path = join(this.root, 'process.lock');
    let handle;
    try { handle = await open(path, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const old = await readJson(path).catch(() => null); let alive = true;
      if (Number.isInteger(old?.pid)) { try { process.kill(old.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; } }
      if (alive) throw new Error('Another maintenance process holds the lock');
      await rename(path, join(this.root, `abandoned-lock-${randomUUID()}.json`)); handle = await open(path, 'wx');
    }
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: this.clock() })); await handle.sync();
    try { return await fn(); } finally { await handle.close(); await rm(path); }
  }
  async initialize() {
    return this.withLock(async () => {
      try { const state = await readJson(this.statePath); if (state.sourceBase !== this.config.baseCommit) throw new Error('Existing maintenance base differs; retain cumulative beta and review the new baseline'); return this.reconcile(state); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      const source = await realpath(this.config.sourceRepo);
      await this.git(['cat-file', '-e', `${this.config.baseCommit}^{commit}`], source);
      await mkdir(join(this.root, 'empty-hooks'), { recursive: true });
      await this.git(['init', '--bare', basename(this.repo)], this.root);
      await this.git(['fetch', '--no-tags', '--no-write-fetch-head', relative(this.repo, source), this.config.baseCommit]);
      await this.git(['update-ref', 'refs/heads/lifeos-beta', this.config.baseCommit]);
      await this.git(['config', 'user.name', 'LifeOS maintenance']); await this.git(['config', 'user.email', 'lifeos-maintenance@localhost']);
      const state = { schemaVersion: 1, sourceBase: this.config.baseCommit, betaHead: this.config.baseCommit, betaRelease: null, productionRelease: null, history: [], jobs: {}, policyFingerprint: policyFingerprint() };
      await durableJson(this.statePath, state); return state;
    });
  }
  async state() { return readJson(this.statePath); }
  async reconcile(state) {
    const actual = await this.git(['rev-parse', 'refs/heads/lifeos-beta']);
    if (state.betaHead === actual) return this.recoverDeployments(state);
    const candidates = await readdir(join(this.root, 'releases')).catch(() => []);
    for (const file of candidates) {
      if (!/^beta-[a-f0-9]{16}\.json$/.test(file)) continue;
      const manifest = await readJson(join(this.root, 'releases', file));
      if (manifest.commit === actual && manifest.parentCommit === state.betaHead && manifest.policyFingerprint === state.policyFingerprint) {
        state.betaHead = actual; state.betaRelease = manifest.releaseId;
        state.jobs[manifest.intentId] = { ...state.jobs[manifest.intentId], status: 'tested-awaiting-deployment', releaseId: manifest.releaseId, commit: actual, summary: manifest.summary, resolved: false };
        await durableJson(this.statePath, state); return this.recoverDeployments(state);
      }
    }
    throw new Error('Beta Git reference and release state disagree; preserve both for review');
  }
  async recoverDeployments(state) {
    const files = await readdir(join(this.root, 'deployments')).catch(() => []), pending = [];
    for (const file of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
      const record = await readJson(join(this.root, 'deployments', file));
      if (!state.history.some(h => h.deploymentKey === record.deploymentKey)) pending.push(record);
    }
    for (const record of pending.sort((a,b) => a.sequence - b.sequence)) {
      const target = this.config.targets?.[record.environment], manifest = await this.release(record.releaseId);
      const previous = record.environment === 'production' ? state.productionRelease : state.history.filter(h => h.environment === 'beta').at(-1)?.releaseId ?? null;
      if (record.sequence !== state.history.length + 1 || record.previousRelease !== previous || record.commit !== manifest.commit || record.origin !== target?.origin || record.status !== 'deployed' || !record.deploymentId) throw new Error('Durable deployment receipt conflicts with current state; review before any deployment');
      state.history.push(record);
      if (record.environment === 'production') state.productionRelease = record.releaseId;
      if (record.environment === 'beta' && state.jobs[manifest.intentId]) state.jobs[manifest.intentId] = { ...state.jobs[manifest.intentId], status: 'beta-ready-for-owner-test', origin: record.origin };
    }
    if (pending.length) await durableJson(this.statePath, state);
    return state;
  }
  async createAttempt(jobId, parent) {
    const id = `${sha256(jobId).slice(0, 8)}-${randomUUID().slice(0, 8)}`, directory = join(this.root, 'attempts', id), worktree = join(directory, 'worktree');
    await mkdir(directory, { recursive: true }); await this.git(['worktree', 'add', '--detach', relative(this.repo, worktree), parent]);
    await mkdir(join(worktree, 'tmp'), { recursive: true });
    const dependencyDirectory = this.config.dependencyDirectory;
    if (dependencyDirectory) {
      // Copy installed dependencies, never a symlink into a production checkout.
      await assertNoLinks(dependencyDirectory);
      const lock = await readFile(join(worktree, 'package-lock.json'));
      if (sha256(lock) !== sha256(await readFile(join(dirname(dependencyDirectory), 'package-lock.json')))) throw new Error('Dependency cache does not match the reviewed package lock');
      await cp(dependencyDirectory, join(worktree, 'node_modules'), { recursive: true, dereference: false, errorOnExist: true });
    }
    return { id, directory, worktree, parent };
  }
  async checkFiles(attempt, before, regressionPath, phase) {
    const after = await snapshot(attempt.worktree), changed = changes(before, after);
    for (const path of changed) {
      safeRelativePath(path);
      if (!after[path]) throw new Error('Automatic maintenance cannot delete an existing file');
      if (phase === 'regression' ? path !== regressionPath : !allowedChange(path, regressionPath)) throw new Error(`Protected or out-of-scope change: ${path}`);
      const issues = scanContent(path, await readFile(join(attempt.worktree, path), 'utf8')); if (issues.length) throw new Error(`${path}: ${issues.join('; ')}`);
    }
    return { after, changed };
  }
  async checkSandbox(attempt, signal) {
    if (!this.runSandbox) throw new Error('A verified sandbox runner is required');
    const outside = join(attempt.directory, 'canary.txt'); await writeFile(outside, 'synthetic-private-canary');
    const code = `const f=require('node:fs');let r=false,w=false;try{f.readFileSync(${JSON.stringify(outside)})}catch{r=true}try{f.writeFileSync(${JSON.stringify(outside)},'changed')}catch{w=true}f.writeFileSync('tmp/inside-probe.txt','allowed');console.log(JSON.stringify({readBlocked:r,writeBlocked:w}));process.exit(r&&w?0:1)`;
    const result = await this.runSandbox({ cwd: attempt.worktree, args: ['-e', code], temporaryDirectory: join(attempt.worktree, 'tmp'), signal, timeoutMs: 30000 });
    if (result.code !== 0 || !result.stdout.includes('"readBlocked":true') || !result.stdout.includes('"writeBlocked":true') || await readFile(outside, 'utf8') !== 'synthetic-private-canary') throw new Error('Sandbox isolation check failed; candidate code was not executed');
    return { status: 'passed', testedAt: this.clock(), outputHash: sha256(result.stdout) };
  }
  async test(attempt, paths, signal) {
    const started = this.clock();
    const result = await this.runSandbox({ cwd: attempt.worktree, args: ['--test', '--test-reporter=tap', ...paths], temporaryDirectory: join(attempt.worktree, 'tmp'), signal, timeoutMs: 240000 });
    const log = `${result.stdout}\n${result.stderr}`, file = join(attempt.directory, `tests-${randomUUID()}.txt`); await writeFile(file, log);
    const passed = result.code === 0 && /# tests [1-9]\d*/.test(log) && !/^# fail [1-9]/m.test(log);
    return { status: passed ? 'passed' : 'failed', exitCode: result.code, startedAt: started, finishedAt: this.clock(), command: ['node', '--test', ...paths], logFile: file, logSha256: sha256(log), tests: Number(log.match(/# tests (\d+)/)?.[1] ?? 0) };
  }
  async testSuite(attempt, signal) {
    const paths=(await walk(attempt.worktree)).filter(path=>/\.(?:test|spec)\.[cm]?js$/.test(path)&&path!=='test/maintenance.test.mjs'&&!path.startsWith('test/cloud-'));
    if(!paths.length)throw Error('Candidate has no discoverable application tests');
    const application=await this.test(attempt,paths,signal),controller=await this.verifyController({...attempt,signal});
    return {status:application.status==='passed'&&controller.status==='passed'?'passed':'failed',tests:application.tests+controller.tests,application,controller};
  }
  async runJob(job, { signal, onProgress = () => {} } = {}) {
    const intent = validateIntent(job);
    return this.withLock(async () => {
      const state = await this.reconcile(await this.state()), previous = state.jobs[intent.id];
      if (previous?.releaseId) {
        if (this.deploy && state.betaRelease === previous.releaseId && !state.history.some(h => h.environment === 'beta' && h.releaseId === previous.releaseId)) return this.deployReleaseLocked({ state, manifest: await this.release(previous.releaseId), environment: 'beta', intentId: intent.id, signal });
        return { ...previous, duplicate: true };
      }
      if ((previous?.attempts ?? 0) >= (this.config.maxAttempts ?? 2)) throw new Error('Maintenance retry limit reached; retained attempts need review');
      if (state.policyFingerprint !== policyFingerprint()) throw new Error('Maintenance policy changed; explicit controller review is required');
      const resuming=previous?.status==='quota-deferred'&&previous.attempt;
      const attempt = resuming?previous.attempt:await this.createAttempt(intent.id, state.betaHead);
      if(resuming&&attempt.parent!==state.betaHead)throw new Error('Cumulative beta changed during quota deferral; preserve this candidate for review');
      if(!isInside(this.root,attempt.directory)||!isInside(attempt.directory,attempt.worktree))throw new Error('Maintenance checkpoint is outside its isolated directory');
      const checkpointPath=join(attempt.directory,'phase-checkpoint.json'),checkpoint=resuming?await readJson(checkpointPath):{};
      if(resuming&&JSON.stringify(await snapshot(attempt.worktree))!==JSON.stringify(checkpoint.tree))throw new Error('Deferred candidate changed outside its checkpoint');
      const saveCheckpoint=async()=>{checkpoint.tree=await snapshot(attempt.worktree);await durableJson(checkpointPath,checkpoint);};
      state.jobs[intent.id] = { status: 'running', attempts: (previous?.attempts ?? 0) + 1, attemptId: attempt.id, attempt, startedAt: this.clock() }; await durableJson(this.statePath, state);
      try {
        if (signal?.aborted) throw new Error('Maintenance cancelled');
        onProgress('Checking isolated test execution'); const isolation = checkpoint.isolation??await this.checkSandbox(attempt, signal);checkpoint.isolation=isolation;
        const original = checkpoint.original??await snapshot(attempt.worktree);checkpoint.original=original;
        if (original[intent.regressionPath]) throw new Error('Regression path already exists');
        onProgress('Reproducing the reported behavior');
        const reproduction = checkpoint.reproduction??await this.runAI({ intent, phase: 'regression', ...attempt, runDirectory: attempt.directory, signal });
        if (reproduction.needsHumanReview) throw new Error('The report needs clarification or protected code changes');
        const regression = checkpoint.regression??await this.checkFiles(attempt, original, intent.regressionPath, 'regression');checkpoint.reproduction=reproduction;checkpoint.regression=regression;await saveCheckpoint();
        if (!regression.after[intent.regressionPath]) throw new Error('A new regression test was not produced');
        const baseline = checkpoint.baseline??await this.test(attempt, [intent.regressionPath], signal);
        if (baseline.status !== 'failed' || baseline.tests < 1) throw new Error('The new test did not reproduce a real failing assertion');
        const baselineLog = await readFile(baseline.logFile, 'utf8');
        if (!/ERR_ASSERTION|AssertionError|assertion/i.test(baselineLog) || /ERR_MODULE_NOT_FOUND|SyntaxError|sandbox failed|EPERM|EACCES/.test(baselineLog)) throw new Error('Baseline failed for setup or syntax rather than the reported behavior');
        checkpoint.baseline=baseline;await saveCheckpoint();
        onProgress('Implementing the isolated fix');
        const implementation = checkpoint.implementation??await this.runAI({ intent, phase: 'implement', ...attempt, runDirectory: attempt.directory, signal });
        if (implementation.needsHumanReview) throw new Error('Implementation requires human review');
        const candidate = checkpoint.candidate??await this.checkFiles(attempt, original, intent.regressionPath, 'implement');
        if (candidate.after[intent.regressionPath] !== regression.after[intent.regressionPath]) throw new Error('Implementation changed the regression assertions');
        if (candidate.changed.length < 2) throw new Error('No implementation change accompanied the regression');
        checkpoint.implementation=implementation;checkpoint.candidate=candidate;await saveCheckpoint();
        onProgress('Testing the candidate and existing behavior');
        const targeted = checkpoint.targeted??await this.test(attempt, [intent.regressionPath], signal), suite = checkpoint.suite??await this.testSuite(attempt, signal);
        if (targeted.status !== 'passed' || suite.status !== 'passed') throw new Error('Candidate tests failed; beta was not changed');
        checkpoint.targeted=targeted;checkpoint.suite=suite;await saveCheckpoint();
        onProgress('Reviewing privacy and data safety');
        const reviewEvidence = { tests: { baseline, targeted, suite }, changedFiles: [] };
        for (const path of candidate.changed) reviewEvidence.changedFiles.push({ path, beforeSha256: original[path] ?? null, afterSha256: candidate.after[path], before: original[path] ? await this.git(['show', `${attempt.parent}:${path}`]) : null, after: await readFile(join(attempt.worktree, path), 'utf8') });
        if (JSON.stringify(reviewEvidence).length > 250000) throw new Error('Candidate exceeds the bounded independent review size');
        const review = checkpoint.review??await this.runAI({ intent, phase: 'review', ...attempt, runDirectory: attempt.directory, reviewEvidence, signal });
        if (review.needsHumanReview || review.risks.length) throw new Error('Candidate has unresolved review findings');
        if (JSON.stringify(await snapshot(attempt.worktree)) !== JSON.stringify(candidate.after)) throw new Error('Tests or review modified candidate code');
        if (signal?.aborted) throw new Error('Maintenance cancelled');
        await this.git(['add', '--', ...candidate.changed], attempt.worktree);
        await this.git(['commit', '-m', `LifeOS maintenance ${intent.id}`], attempt.worktree);
        const commit = await this.git(['rev-parse', 'HEAD'], attempt.worktree), releaseId = `beta-${commit.slice(0, 16)}`;
        const manifest = { schemaVersion: 1, releaseId, commit, parentCommit: attempt.parent, intentId: intent.id, createdAt: this.clock(), worktree: attempt.worktree, policyFingerprint: policyFingerprint(), changedFiles: candidate.changed.map(path => ({ path, sha256: candidate.after[path] })), tree: candidate.after, summary: implementation.summary, risks: review.risks, isolation, tests: { baseline, targeted, suite }, dataMigration: 'none', status: 'tested-awaiting-deployment', runtimeCapability: 'isolated-code-tests' };
        await durableJson(join(this.root, 'releases', `${releaseId}.json`), manifest, true);
        await this.git(['update-ref', 'refs/heads/lifeos-beta', commit, attempt.parent]);
        state.betaHead = commit; state.betaRelease = releaseId;
        const result = { status: manifest.status, releaseId, commit, attempts: state.jobs[intent.id].attempts, summary: manifest.summary, resolved: false };
        state.jobs[intent.id] = result; await durableJson(this.statePath, state);
        if (this.deploy) return this.deployReleaseLocked({ state, manifest, environment: 'beta', intentId: intent.id, signal });
        return result;
      } catch (error) {
        const deferred=['quota_deferred','usage_limited'].includes(error.code);if(deferred)await saveCheckpoint();
        state.jobs[intent.id] = { ...state.jobs[intent.id],...(deferred?{attempts:Math.max(0,state.jobs[intent.id].attempts-1)}:{}),status: signal?.aborted ? 'cancelled' : deferred?'quota-deferred':'needs-review', error: error.message, finishedAt: this.clock() };
        await durableJson(this.statePath, state); throw error;
      }
    });
  }
  async release(releaseId) {
    if (!/^beta-[a-f0-9]{16}$/.test(releaseId)) throw new Error('Release identity is invalid');
    return readJson(join(this.root, 'releases', `${releaseId}.json`));
  }
  async prepareInitialRelease({ authority }, { signal } = {}) {
    if (authority !== 'initial-build-authorized') throw new Error('Initial release preparation requires the authorized build controller');
    return this.withLock(async () => this.prepareInitialReleaseLocked(await this.reconcile(await this.state()), signal));
  }
  async prepareInitialReleaseLocked(state, signal) {
    if (state.betaHead !== state.sourceBase) throw new Error('Cumulative beta has moved beyond the initial build');
    const releaseId = `beta-${state.sourceBase.slice(0,16)}`;
    const existing = await this.release(releaseId).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing) {
      if (existing.commit !== state.sourceBase || existing.intentId !== 'initial-production' || existing.policyFingerprint !== policyFingerprint() || existing.tests.suite.status !== 'passed' || JSON.stringify(await snapshot(existing.worktree)) !== JSON.stringify(existing.tree)) throw new Error('Prepared initial release differs from its verified baseline');
      if(state.betaRelease!==releaseId){state.betaRelease=releaseId;await durableJson(this.statePath,state);}
      return existing;
    }
    const attempt = await this.createAttempt('initial-production', state.sourceBase), isolation = await this.checkSandbox(attempt, signal), tree = await snapshot(attempt.worktree), suite = await this.testSuite(attempt, signal);
    if (suite.status !== 'passed') throw new Error('Initial production baseline failed isolated tests');
    if (JSON.stringify(await snapshot(attempt.worktree)) !== JSON.stringify(tree)) throw new Error('Baseline tests modified source files');
    const manifest = { schemaVersion:1, releaseId, commit:state.sourceBase, parentCommit:null, intentId:'initial-production', createdAt:this.clock(), worktree:attempt.worktree, policyFingerprint:policyFingerprint(), changedFiles:[], tree, summary:'Initial authorized production build', risks:[], isolation, tests:{baseline:null,targeted:suite,suite}, dataMigration:'none', status:'tested-initial-build', runtimeCapability:'isolated-code-tests' };
    await durableJson(join(this.root,'releases',`${releaseId}.json`),manifest,true);
    state.betaRelease=releaseId;await durableJson(this.statePath,state);return manifest;
  }
  async registerProductionBaseline({ authority, receipt, backupEvidence }, { signal } = {}) {
    if (authority !== 'initial-build-authorized') throw new Error('Initial production registration requires the authorized build controller');
    return this.withLock(async () => {
      const state = await this.reconcile(await this.state()); if (state.productionRelease) throw new Error('Production already has a registered baseline');
      validateTargets(this.config.targets); const target = this.config.targets.production;
      if (receipt?.environment !== 'production' || receipt.commit !== state.sourceBase || receipt.origin !== target.origin || !receipt.deploymentId || receipt.healthy !== true || receipt.authenticationVerified !== true || receipt.dataIsolated !== true) throw new Error('Initial production receipt does not verify the exact baseline');
      if (!backupEvidence?.verified || !backupEvidence.backupId || !/^[a-f0-9]{64}$/.test(backupEvidence.sha256 ?? '')) throw new Error('Initial production requires a verified backup');
      const manifest = await this.prepareInitialReleaseLocked(state, signal), releaseId = manifest.releaseId;
      const record={sequence:state.history.length+1,deploymentKey:`production:${releaseId}:initial-production`,releaseId,commit:state.sourceBase,environment:'production',previousRelease:null,deploymentId:receipt.deploymentId,origin:receipt.origin,verifiedAt:this.clock(),rollback:false,backupEvidence,status:'deployed',resolved:false};
      await durableJson(join(this.root,'deployments',`${sha256(record.deploymentKey)}.json`),record,true);state.history.push(record);state.productionRelease=releaseId;await durableJson(this.statePath,state);return record;
    });
  }
  async deployReleaseLocked({ state, manifest, environment, intentId, signal, rollback = false, backupEvidence = null }) {
    if (!this.deploy) throw new Error('The reviewed deployment hook is not configured');
    validateTargets(this.config.targets);
    if (manifest.policyFingerprint !== policyFingerprint() || manifest.tests.targeted.status !== 'passed' || manifest.tests.suite.status !== 'passed') throw new Error('Release has not passed the current gate');
    if (JSON.stringify(await snapshot(manifest.worktree)) !== JSON.stringify(manifest.tree)) throw new Error('Release files changed after verification');
    const target = this.config.targets[environment];
    if (signal?.aborted) throw new Error('Maintenance cancelled');
    const deploymentKey = `${environment}:${manifest.releaseId}:${intentId}`;
    const prior = state.history.find(h => h.deploymentKey === deploymentKey); if (prior) return prior;
    const previousDeployment = state.history.filter(h=>h.environment===environment).at(-1);
    const expectedPrevious = previousDeployment ? {commit:previousDeployment.commit,releaseId:previousDeployment.releaseId} : null;
    const receipt = await this.deploy({ target: { ...target }, release: structuredClone(manifest), deploymentKey, expectedPrevious, rollback, backupEvidence, signal });
    if (!receipt || receipt.environment !== environment || receipt.commit !== manifest.commit || receipt.origin !== target.origin || receipt.healthy !== true || receipt.authenticationVerified !== true || !receipt.deploymentId || receipt.dataIsolated !== true) throw new Error('Deployment verification failed; the release is not marked live');
    const record = { sequence: state.history.length + 1, deploymentKey, releaseId: manifest.releaseId, commit: manifest.commit, environment, previousRelease: environment === 'production' ? state.productionRelease : state.history.filter(h => h.environment === 'beta').at(-1)?.releaseId ?? null, deploymentId: receipt.deploymentId, origin: receipt.origin, verifiedAt: this.clock(), rollback, backupEvidence, status: 'deployed', resolved: false };
    await durableJson(join(this.root, 'deployments', `${sha256(deploymentKey)}.json`), record, true);
    state.history.push(record); if (environment === 'production') state.productionRelease = manifest.releaseId;
    if (state.jobs[intentId]) state.jobs[intentId] = { ...state.jobs[intentId], status: 'beta-ready-for-owner-test', origin: target.origin };
    await durableJson(this.statePath, state); return record;
  }
  async releaseAction({ id, authority, intentional, action, releaseId, expectedCurrentRelease, backupEvidence }, { signal } = {}) {
    if (authority !== 'authenticated-release-action' || intentional !== true || !/^[a-zA-Z0-9_-]{1,100}$/.test(id ?? '') || !['promote', 'rollback', 'deploy-beta'].includes(action)) throw new Error('An explicit authenticated release action is required');
    return this.withLock(async () => {
      const state = await this.reconcile(await this.state()), manifest = await this.release(releaseId);
      const already = state.history.find(h => h.deploymentKey === `${action === 'deploy-beta' ? 'beta' : 'production'}:${releaseId}:${id}`);
      if (already) return { ...already, duplicate: true };
      if (action === 'deploy-beta') {
        if (state.betaRelease !== releaseId) throw new Error('Only the current cumulative beta can be deployed');
        return this.deployReleaseLocked({ state, manifest, environment: 'beta', intentId: id, signal });
      }
      if (state.productionRelease !== expectedCurrentRelease) throw new Error('Production changed since this action was confirmed');
      if (!backupEvidence?.verified || !/^[a-f0-9]{64}$/.test(backupEvidence.sha256 ?? '') || !backupEvidence.backupId) throw new Error('A verified current production backup is required');
      if (action === 'promote' && !state.history.some(h => h.environment === 'beta' && h.releaseId === releaseId)) throw new Error('Promotion requires a verified beta deployment');
      if (action === 'rollback' && !state.history.some(h => h.environment === 'production' && h.releaseId === releaseId)) throw new Error('Rollback must select a prior production release');
      return this.deployReleaseLocked({ state, manifest, environment: 'production', intentId: id, rollback: action === 'rollback', backupEvidence, signal });
    });
  }
}
