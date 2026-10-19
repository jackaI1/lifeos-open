import {httpsOrigin} from '../shared/service-config.mjs';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const POLICY_VERSION = 1;
export const PROTECTED_PATHS = Object.freeze([
  'AGENTS.md', '.github', '.ai', '.gitignore', 'package.json', 'package-lock.json',
  'src/maintenance', 'src/server', 'src/runtime', 'src/integrations/google.mjs',
  'src/domain', 'src/cloud', 'src/shared', 'wrangler.cloud.jsonc', 'wrangler.cloud.production.jsonc', 'docs/quota-policy.md', 'docs/runbook.md', 'NEXT_SESSION.md',
  'src/gateway', 'worker', 'migrations', 'wrangler.toml', 'wrangler.json', 'wrangler.jsonc',
  'tools', 'docs/architecture.md', 'docs/lifeos-spec.md', 'docs/authorization-log.md',
  'docs/maintenance.md', 'test'
]);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const policyFingerprint = () => sha256(JSON.stringify({ version: POLICY_VERSION, protectedPaths: PROTECTED_PATHS }));
export function safeRelativePath(path) {
  if (typeof path !== 'string' || path.length > 300 || !/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) throw new Error('Unsafe maintenance file path');
  if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(path.split('/').at(-1))) throw new Error('Reserved maintenance file path');
  return path;
}
export function allowedChange(path, regressionPath) {
  safeRelativePath(path);
  if (path === regressionPath) return true;
  if (PROTECTED_PATHS.some(p => path.toLowerCase() === p.toLowerCase() || path.toLowerCase().startsWith(`${p.toLowerCase()}/`))) return false;
  return /^(public|docs)\//.test(path) && /\.(mjs|js|css|html|svg|json|md)$/.test(path);
}
export function isInside(base, candidate) { const rel = relative(resolve(base), resolve(candidate)); return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); }
export function validateIntent(job) {
  if (job?.type !== 'maintenance' || job?.authority !== 'authenticated-intentional-report' || !/^[a-zA-Z0-9_-]{1,100}$/.test(job.id ?? '')) throw new Error('Only a trusted authenticated maintenance job may change code');
  if (job.payload?.intentional !== true) throw new Error('The authenticated route must stamp intentional maintenance consent');
  const description = job.payload.description;
  if (typeof description !== 'string' || !description.trim() || description.length > 10000) throw new Error('An intentional feature or bug description is required');
  const diagnostics = {};
  for (const key of ['online', 'userAgent', 'errorCode', 'route', 'version']) {
    const value = job.payload.diagnostics?.[key];
    if (typeof value === 'string' && value.length <= 500 || typeof value === 'boolean') diagnostics[key] = value;
  }
  return { id: job.id, description, diagnostics, regressionPath: `test/regressions/${job.id}.test.mjs` };
}
export function normalizedDeploymentTargets(targets){
 return Object.fromEntries(Object.entries(targets??{}).map(([key,target])=>[key,target?{...target,origin:httpsOrigin(target.origin),...(target.directOrigin?{directOrigin:httpsOrigin(target.directOrigin)}:{}),...(Array.isArray(target.alternateOrigins)?{alternateOrigins:target.alternateOrigins.map(httpsOrigin)}:{})}:target]));
}
export function validateTargets(targets) {
  const {beta,production}=normalizedDeploymentTargets(targets);
  if (beta?.environment !== 'beta' || production?.environment !== 'production') throw new Error('Explicit beta and production targets are required');
  const cloud = beta.storage === 'cloud' && production.storage === 'cloud';
  if ((beta.storage === 'cloud' || production.storage === 'cloud') && !cloud) throw new Error('Mixed local and cloud targets are prohibited');
  for (const target of [beta, production]) {
    const url = new URL(target.origin);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.port || url.search || url.hash) throw new Error('Deployment origin is invalid');
    for (const key of cloud ? ['dataDir','archiveRootId','workerCredentialId','databaseId','deploymentTarget','jobNamespace'] : ['dataDir', 'archiveRootId', 'gatewaySecretId', 'deploymentTarget', 'jobNamespace']) if (!target[key]) throw new Error(`Deployment target needs ${key}`);
    if (!isAbsolute(target.dataDir)) throw new Error('Data directory must be absolute');
    if (cloud && (!/^[a-f0-9-]{36}$/.test(target.databaseId) || !Array.isArray(target.alternateOrigins) || target.alternateOrigins.length < 1 || target.alternateOrigins.length > 8)) throw new Error('Explicit cloud database and alternate origins required');
  }
  const origins=target=>[target.origin,...(target.directOrigin?[target.directOrigin]:[]),...(target.alternateOrigins??[])];
  const betaOrigins=origins(beta),productionOrigins=origins(production);
  if(new Set(betaOrigins).size!==betaOrigins.length||new Set(productionOrigins).size!==productionOrigins.length||betaOrigins.some(value=>productionOrigins.includes(value)))throw new Error('Beta and production origins and alternate origins must be distinct');
  for (const key of cloud ? ['origin','archiveRootId','workerCredentialId','databaseId','deploymentTarget','jobNamespace'] : ['origin', 'archiveRootId', 'gatewaySecretId', 'deploymentTarget', 'jobNamespace']) if (beta[key] === production[key]) throw new Error(`Beta and production share ${key}`);
  if (resolve(beta.dataDir).toLowerCase() === resolve(production.dataDir).toLowerCase() || isInside(beta.dataDir, production.dataDir) || isInside(production.dataDir, beta.dataDir)) throw new Error('Beta and production data must be separate directories');
  if (beta.calendarWritesAllowed !== false || (cloud ? beta.ownerOnly !== true : beta.syntheticDataOnly !== true)) throw new Error('Beta requires protected isolated data with calendar writes disabled');
  return true;
}
export function scanContent(path, content) {
  const issues = [];
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|GOCSPX-[A-Za-z0-9_-]{15,}|gh[pousr]_[A-Za-z0-9]{20,}/.test(content)) issues.push('Possible credential in candidate content');
  if (/(?:C:\\Users\\|\/Users\/|\/home\/)[^\s'"`]+|\.preflight-private|source-connections\.json/.test(content) && !path.startsWith('docs/')) issues.push('Private filesystem reference in candidate code');
  if (/\beval\s*\(|\bnew\s+Function\s*\(|child_process|process\.binding\s*\(/.test(content)) issues.push('Dynamic code or process capability needs manual review');
  return issues;
}
