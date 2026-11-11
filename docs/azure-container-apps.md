# Azure Container Apps demo

I built this so the fictional public demo can run on Azure without me managing a
server. The whole setup is code: a Bicep template in [deploy/azure](../deploy/azure)
describes the Azure resources, and a GitHub Actions workflow tests and deploys them.
The demo is the same browser-only image as the [hosted demo](../HOSTED_DEMO.md).
It holds no personal data.

## What gets created

| Resource | Purpose |
| --- | --- |
| Log Analytics workspace | Container logs, 30 days, capped at 1 GB a day |
| Key Vault (RBAC, soft delete) | Holds `lifeos-demo-session-secret` |
| User-assigned managed identity | Can read secrets in that vault and nothing else |
| Container Apps environment | Hosts the app |
| Container App | Runs the public image on port 8080 with HTTPS ingress, 0.25 vCPU, 0.5 GiB, 0 to 1 replicas |

The image comes from a public GitHub Container Registry package, so no registry
is billed. The Key Vault secret is read by the app's environment variable
`LIFEOS_DEMO_SESSION_SECRET`. The static demo does not use that value yet; the
wiring is there so a future server feature can read it without an environment file.

## Check it locally (no Azure account)

Install the standalone Bicep CLI, then:

```sh
bicep build deploy/azure/main.bicep --outfile /tmp/lifeos-aca.json
node deploy/azure/test/check-template.mjs /tmp/lifeos-aca.json
npm run test:azure
docker build --target public-demo -t lifeos-public:local .
docker run -d --name lifeos-health -p 8080:8080 lifeos-public:local
node deploy/azure/healthcheck.mjs http://127.0.0.1:8080
docker rm -f lifeos-health
```

The last container command stops the container I started. Docker needs about 2 GB
of free disk for the build.

## One-time Azure setup (my account)

These steps need my Azure subscription and GitHub settings, so the workflow cannot
do them for me:

1. Create an app registration in Microsoft Entra ID for GitHub Actions and add a
   federated credential for `repo:jackaI1/lifeos-open:environment:azure-public-demo`.
   I create the resource group `lifeos-public-aca` myself, then give the service
   principal Owner on it. Owner is needed because the template assigns Key Vault
   roles to the identity and to the deploy principal.
2. In the repository settings, add these variables: `AZURE_DEMO_CLIENT_ID`,
   `AZURE_DEMO_TENANT_ID` and `AZURE_DEMO_SUBSCRIPTION_ID`. They are IDs, not passwords.
3. Create the `azure-public-demo` environment, optionally with a required reviewer.
4. After the first image push, make the `lifeos-public` GHCR package public so
   Azure can pull it without credentials.

The workflow skips the what-if and deploy jobs until the variables exist, so the
CI checks still run on every pull request.

## What the workflow does

- **validate** compiles the Bicep, runs the template check and the health-check tests.
- **container-health** builds the public-demo image, runs it on a local port, checks
  `/healthz` and stops that container.
- **what-if** previews the foundation changes on pull requests from this repository.
- **deploy** runs on merge to `main`. It creates the foundation (Key Vault, identity,
  environment) with the app turned off, writes the secret only if it is missing,
  pushes the image, records the running image, deploys the app and checks its public
  URL. If that check fails, it moves the app back to the recorded image.

The secret value is made with `openssl rand` inside the job and is never printed.

## Cost and cleanup

The Consumption plan's monthly free grant covers about 200 hours of running time at
0.25 vCPU and 0.5 GiB. Scale-to-zero means an idle demo costs close to nothing. See
the README section for the numbers I checked.

To remove everything:

```sh
az group delete --name lifeos-public-aca --yes
```

Key Vault soft delete keeps a deleted vault for 7 days; purge it with
`az keyvault purge --name NAME` if I need the name back sooner.
