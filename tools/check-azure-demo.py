"""Check the compiled Bicep, including the nested resource-group template."""
import json
import sys
from pathlib import Path


def check(template):
    resources = template["resources"]
    assert any(r["type"] == "Microsoft.Resources/resourceGroups" for r in resources)
    deployment = next(r for r in resources if r["type"] == "Microsoft.Resources/deployments")
    nested = deployment["properties"]["template"]["resources"]
    by_type = {r["type"]: r for r in nested}
    for name in ["Microsoft.ContainerRegistry/registries", "Microsoft.ManagedIdentity/userAssignedIdentities", "Microsoft.OperationalInsights/workspaces", "Microsoft.App/managedEnvironments", "Microsoft.Authorization/roleAssignments"]:
        assert name in by_type, name
    app = by_type["Microsoft.App/containerApps"]
    assert app["identity"]["type"] == "UserAssigned"
    ingress = app["properties"]["configuration"]["ingress"]
    assert ingress["external"] is True and ingress["allowInsecure"] is False
    assert ingress["targetPort"] == 8080
    assert app["properties"]["template"]["scale"] == {"minReplicas": 0, "maxReplicas": 1}
    assert by_type["Microsoft.ContainerRegistry/registries"]["properties"]["adminUserEnabled"] is False
    assert "7f951dda-4ed3-4680-a7ca-43fe172d538d" in json.dumps(by_type["Microsoft.Authorization/roleAssignments"])
    assert "identity" in app["properties"]["configuration"]["registries"][0]
    return True


if __name__ == "__main__":
    assert check(json.loads(Path(sys.argv[1]).read_text()))
    print("Compiled Azure template: resource group, HTTPS, managed pull, logs and replica limit passed")
