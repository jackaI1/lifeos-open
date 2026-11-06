targetScope = 'resourceGroup'

@minLength(3)
@maxLength(11)
@description('Lowercase letters and digits; choose a unique public resource prefix.')
param namePrefix string
param location string = resourceGroup().location
@description('Public Linux amd64 image, such as ghcr.io/OWNER/lifeos-azure-feed:TAG. No registry credentials in this template.')
param containerImage string
@description('Object ID of the Microsoft Entra user or group that will initialize the database.')
param sqlAdminObjectId string
param sqlAdminLogin string
@allowed(['User', 'Group'])
param sqlAdminType string = 'User'
@description('Public IPv4 address of the machine that runs the fixed-fixture publisher.')
param publisherIp string

var suffix = uniqueString(resourceGroup().id, namePrefix)
var appName = '${namePrefix}-${suffix}'
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${namePrefix}${suffix}'
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
  }
}
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${appName}-plan'
  location: location
  kind: 'linux'
  sku: { name: 'B1', tier: 'Basic' }
  properties: { reserved: true }
}
resource server 'Microsoft.Sql/servers@2023-08-01' = {
  name: '${appName}-sql'
  location: location
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      principalType: sqlAdminType
      login: sqlAdminLogin
      sid: sqlAdminObjectId
      tenantId: tenant().tenantId
    }
  }
}
resource database 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: server
  name: 'lifeos-demo'
  location: location
  sku: { name: 'Basic', tier: 'Basic', capacity: 5 }
  properties: { maxSizeBytes: 2147483648 }
}
// Shared Azure network access still requires an authenticated database user.
// See the deployment guide before using this public-demo topology for other data.
resource azureFirewall 'Microsoft.Sql/servers/firewallRules@2023-08-01' = {
  parent: server
  name: 'AzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}
resource publisherFirewall 'Microsoft.Sql/servers/firewallRules@2023-08-01' = {
  parent: server
  name: 'Publisher'
  properties: { startIpAddress: publisherIp, endIpAddress: publisherIp }
}
resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'functionapp,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${containerImage}'
      alwaysOn: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/api/health'
      cors: { allowedOrigins: ['https://lifeos.jacklai.ca'], supportCredentials: false }
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'FUNCTIONS_NODE_BLOCK_ON_ENTRY_POINT_ERROR', value: 'true' }
        { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'false' }
        { name: 'WEBSITES_PORT', value: '80' }
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'SQL_SERVER', value: server.properties.fullyQualifiedDomainName }
        { name: 'SQL_DATABASE', value: database.name }
      ]
    }
  }
}
resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, app.id, 'blob-owner')
  scope: storage
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b') // Storage Blob Data Owner
  }
}
resource queueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, app.id, 'queue-contributor')
  scope: storage
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '974c5e8b-45b9-4653-ba55-5f855dd0fb88') // Storage Queue Data Contributor
  }
}
output feedUrl string = 'https://${app.properties.defaultHostName}/api/demo/today'
output functionName string = app.name
output functionPrincipalId string = app.identity.principalId
output sqlServer string = server.properties.fullyQualifiedDomainName
output sqlDatabase string = database.name
