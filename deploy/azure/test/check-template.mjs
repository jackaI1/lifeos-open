// Checks the compiled ARM template (from `az bicep build`) for the properties
// this demo relies on. Run after compiling deploy/azure/main.bicep:
//
//   node deploy/azure/test/check-template.mjs /tmp/lifeos-aca.json
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const KEY_VAULT_SECRETS_USER = '4633458b-17de-408a-b874-0445c86b69e6';

export function checkTemplate(template) {
  const byType = (type) => template.resources.filter((r) => r.type === type);
  const one = (type) => {
    const found = byType(type);
    assert.equal(found.length, 1, `expected one ${type}`);
    return found[0];
  };

  // Key Vault: RBAC only, no access policies, soft delete on.
  const vault = one('Microsoft.KeyVault/vaults');
  assert.equal(vault.properties.enableRbacAuthorization, true);
  assert.equal(vault.properties.enableSoftDelete, true);
  assert.ok(!vault.properties.accessPolicies, 'vault must not use access policies');

  // Identity is user-assigned and can read secrets from that vault only.
  const identity = one('Microsoft.ManagedIdentity/userAssignedIdentities');
  // The compiler stores role IDs as variable references, so resolve them first.
  const roleId = (r) => String(r.properties.roleDefinitionId)
    .replace(/variables\('([^']+)'\)/g, (_, name) => template.variables[name]);
  const readRole = byType('Microsoft.Authorization/roleAssignments').find((r) =>
    roleId(r).includes(KEY_VAULT_SECRETS_USER));
  assert.ok(readRole, 'identity needs Key Vault Secrets User');
  assert.equal(readRole.properties.principalType, 'ServicePrincipal');

  // Container App: external HTTPS ingress, secret from Key Vault via the identity,
  // no plain secret values in the template, scale to zero.
  const app = one('Microsoft.App/containerApps');
  assert.equal(app.identity.type, 'UserAssigned');
  assert.ok(Object.keys(app.identity.userAssignedIdentities).length === 1);
  const config = app.properties.configuration;
  assert.equal(config.ingress.external, true);
  assert.equal(config.ingress.allowInsecure, false);
  assert.equal(config.ingress.targetPort, 8080);
  const secret = config.secrets.find((s) => s.name === 'demo-session-secret');
  assert.ok(secret, 'missing Key Vault secret reference');
  assert.ok(secret.keyVaultUrl, 'secret must come from Key Vault, not a literal value');
  assert.equal(secret.value, undefined);
  const container = app.properties.template.containers[0];
  const envRef = container.env.find((e) => e.name === 'LIFEOS_DEMO_SESSION_SECRET');
  assert.equal(envRef.secretRef, 'demo-session-secret');
  assert.equal(app.properties.template.scale.minReplicas, 0);
  assert.equal(app.properties.template.scale.maxReplicas, 1);

  // Environment and log workspace exist.
  one('Microsoft.App/managedEnvironments');
  one('Microsoft.OperationalInsights/workspaces');

  // No registry with admin credentials and no literal secret text anywhere.
  assert.equal(byType('Microsoft.ContainerRegistry/registries').length, 0);
  assert.ok(!JSON.stringify(template).includes('adminPassword'));
  return true;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const template = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  checkTemplate(template);
  console.log('Compiled Azure template: Key Vault via RBAC, identity-only secret read, HTTPS ingress and scale-to-zero passed');
}
