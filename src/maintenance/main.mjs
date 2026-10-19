import { readFile, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../server/store.mjs';
import { createIntegrationRunner } from '../integrations/jobs.mjs';
import { MaintenancePipeline } from './pipeline.mjs';
import { createMaintenanceAI } from './ai.mjs';
import { sandboxRunner } from './process.mjs';
import { createTrustedDeploymentHook } from './deploy.mjs';
import { runMaintenanceWorker } from './worker.mjs';

export function createReleasePreparer(integrations) {
  return async (job, { signal, progress = () => {} } = {}) => {
    const payload = job.payload ?? {};
    if (job.authority !== 'authenticated-release-action' || payload.intentional !== true || !/^[A-Za-z0-9_-]{1,80}$/.test(job.id ?? '') || !['promote', 'rollback', 'deploy-beta'].includes(payload.action)) throw new Error('Release backup needs an intentional authenticated action');
    const result = { action: payload.action, releaseId: payload.releaseId, expectedCurrentRelease: payload.expectedCurrentRelease, intentional: true, backupEvidence: null };
    if (payload.action !== 'deploy-beta') {
      const id = `release-backup-${job.id}`;
      const backup = await integrations.run({ job: { id, type: 'backup', authority: 'trusted-maintenance-controller', payload: {} }, signal, progress });
      if (backup.cloudVerified !== true || !/^[a-f0-9]{64}$/.test(backup.manifestSha256 ?? '')) throw new Error('Production release waits for a fresh verified cloud backup');
      result.backupEvidence = { verified: true, backupId: id, sha256: backup.manifestSha256 };
    }
    return result;
  };
}

export async function createMaintenanceService(config) {
  const productionConfig = JSON.parse(await readFile(resolve(config.targets.production.backendConfigFile), 'utf8'));
  if (productionConfig.environment !== 'production' || resolve(productionConfig.dataDir).toLowerCase() !== resolve(config.jobDataDir).toLowerCase()) throw new Error('Maintenance jobs must use the trusted production job store');
  const betaConfig = JSON.parse(await readFile(resolve(config.targets.beta.backendConfigFile), 'utf8'));
  if (betaConfig.environment !== 'beta' || betaConfig.integrationsEnabled !== false || resolve(betaConfig.dataDir).toLowerCase() !== resolve(config.targets.beta.dataDir).toLowerCase() || (await realpath(betaConfig.dataDir)).toLowerCase() === (await realpath(productionConfig.dataDir)).toLowerCase()) throw new Error('Beta maintenance needs its separate configured job store');
  const store = new Store(join(resolve(config.jobDataDir), 'lifeos.sqlite'));
  const betaStore = new Store(join(resolve(betaConfig.dataDir), 'lifeos.sqlite')), stores = [{store,environment:'production'},{store:betaStore,environment:'beta'}];
  const integrations = createIntegrationRunner({ store, config: productionConfig });
  const pipeline = new MaintenancePipeline(config, {
    runAI: createMaintenanceAI({ executable: config.aiExe, nodeExe: process.execPath, model: config.aiModel, effort: config.aiEffort }),
    runSandbox: sandboxRunner({ aiExe: config.aiExe, nodeExe: process.execPath }),
    deploy: createTrustedDeploymentHook(config)
  });
  const prepareRelease = createReleasePreparer(integrations);
  return { store, betaStore, pipeline, prepareRelease, run: ({ signal, once = false, intervalMs = 5000 } = {}) => runMaintenanceWorker({ stores, pipeline, prepareRelease, signal, once, intervalMs }), close: () => {store.close();betaStore.close();} };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = resolve(process.env.LIFEOS_MAINTENANCE_CONFIG ?? '.lifeos/maintenance/config.json');
  const service = await createMaintenanceService(JSON.parse(await readFile(path, 'utf8'))), controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => controller.abort());
  try { await service.run({ signal: controller.signal, once: process.argv.includes('--once') }); } finally { service.close(); }
}
