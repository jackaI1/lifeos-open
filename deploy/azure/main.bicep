// LifeOS public demo on Azure Container Apps.
// Creates: Log Analytics, a Key Vault holding the demo secret, a user-assigned
// managed identity that can read only that secret, a Container Apps environment
// and the demo container. The image is pulled from a public GHCR package, so
// no container registry is billed. Run with `az deployment group create`.

targetScope = 'resourceGroup'

@description('Lowercase letters and digits, 3 to 11 characters. Used in every resource name.')
@minLength(3)
@maxLength(11)
param prefix string

param location string = resourceGroup().location

@description('Public image built by the workflow, for example ghcr.io/OWNER/lifeos-public:TAG.')
param containerImage string

@description('Name of the secret in Key Vault that the container reads as an environment variable.')
param demoSecretName string = 'lifeos-demo-session-secret'

@description('Object ID of the deploy identity. It gets Key Vault Secrets Officer so the workflow can set the secret. Leave empty to skip.')
param deployerObjectId string = ''

@description('Set to false on the first run, before the Key Vault secret exists. A Container App cannot reference a missing secret.')
param deployApp bool = true

var suffix = take(uniqueString(resourceGroup().id), 8)
var vaultName = '${take(prefix, 11)}kv${suffix}'

// Role definition IDs (built-in Azure roles).
var keyVaultSecretsUserRole = '4633458b-17de-408a-b874-0445c86b69e6'
var keyVaultSecretsOfficerRole = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: 1 }
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-demo-identity'
  location: location
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

// The demo container can read secrets in this vault and nothing else.
resource identityReadsSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, identity.id, keyVaultSecretsUserRole)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRole)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource deployerWritesSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerObjectId)) {
  name: guid(vault.id, deployerObjectId, keyVaultSecretsOfficerRole)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsOfficerRole)
    principalId: deployerObjectId
    principalType: 'ServicePrincipal'
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-aca-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = if (deployApp) {
  name: '${prefix}-demo'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http'
        allowInsecure: false
      }
      // The secret value is read from Key Vault at runtime with the managed identity.
      // No value is stored in this template, in the image or in an env file.
      secrets: [
        {
          name: 'demo-session-secret'
          keyVaultUrl: '${vault.properties.vaultUri}secrets/${demoSecretName}'
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'demo'
          image: containerImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'PORT'
              value: '8080'
            }
            {
              name: 'PARENT_ORIGIN'
              value: 'https://jacklai.ca'
            }
            {
              name: 'LIFEOS_DEMO_SESSION_SECRET'
              secretRef: 'demo-session-secret'
            }
          ]
        }
      ]
      // Scale to zero when idle so a quiet demo costs almost nothing.
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
  dependsOn: [identityReadsSecrets]
}

output vaultName string = vault.name
output vaultUri string = vault.properties.vaultUri
output identityPrincipalId string = identity.properties.principalId
output demoUrl string = deployApp ? 'https://${app!.properties.configuration.ingress.fqdn}' : ''
