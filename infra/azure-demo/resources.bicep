targetScope = 'resourceGroup'
param location string
param prefix string
param imageTag string
param deployApp bool
var suffix = uniqueString(resourceGroup().id)
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: '${prefix}${suffix}'
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-pull'
  location: location
}
resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, 'AcrPull')
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-environment'
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
      registries: [{
        server: registry.properties.loginServer
        identity: identity.id
      }]
    }
    template: {
      containers: [{
        name: 'demo'
        image: '${registry.properties.loginServer}/lifeos-public:${imageTag}'
        resources: {
          cpu: json('0.25')
          memory: '0.5Gi'
        }
        env: [
          {
            name: 'DEMO_ORIGIN'
            value: 'https://${prefix}-demo.${environment.properties.defaultDomain}'
          }
          {
            name: 'PARENT_ORIGIN'
            value: 'https://jacklai.ca'
          }
        ]
      }]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
  dependsOn: [pull]
}
output registryName string = registry.name
output demoUrl string = deployApp ? 'https://${app!.properties.configuration.ingress.fqdn}' : ''
