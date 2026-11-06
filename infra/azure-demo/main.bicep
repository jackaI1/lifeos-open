targetScope = 'subscription'
param location string = 'canadacentral'
param resourceGroupName string = 'lifeos-public-study'
@minLength(3)
@maxLength(12)
param prefix string = 'lifeosdemo'
param imageTag string = 'initial'
param deployApp bool = false
resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
}
module demo 'resources.bicep' = {
  name: 'lifeos-public-resources'
  scope: group
  params: {
    location: location
    prefix: prefix
    imageTag: imageTag
    deployApp: deployApp
  }
}
output registryName string = demo.outputs.registryName
output demoUrl string = demo.outputs.demoUrl
