# Serving the public Today feed

I built a separate home for the fictional Today feed because I want the phone
demo to refresh without keeping my personal workspace online. It returns the
same schedule and deadlines as `public/demo/today.json`. The phone's existing
saved-copy behavior still works when the endpoint is unavailable.

This is an optional deployment. The phone uses the public file on GitHub until I
set `EXPO_PUBLIC_DEMO_FEED_URL` to my endpoint. There is no private workspace
connection and no upload or write route.

## Try it locally

I need Node.js 24, Docker with Compose v2, and Azure Functions Core Tools v4,
Microsoft's local function runner. SQL Server needs about 2 GB of container
memory and several GB of free disk. On an Apple Silicon Mac, Docker also needs
amd64 emulation, such as Colima with Rosetta enabled. A Linux amd64 machine is
the straightforward option for the database checks.

```sh
npm install -g azure-functions-core-tools@4.16.0
cd integrations/azure-feed
npm ci
npm run build
npm test
npm run dev
```

The last command starts SQL Server, Azurite (a local copy of Azure storage),
and the actual Functions host. It creates a database, publishes the authored
fictional feed and prints a URL such as `http://127.0.0.1:PORT/api/demo/today`.
I open that URL or run `curl` against it. `/api/health` returns readiness and
writes a small heartbeat through the storage binding, the host's connection to
blob storage. A blob is a file stored by name.

Ctrl-C stops these owned processes and removes the disposable database and
storage. Each run prints its unique fixture name and a temporary ownership file
with exact process IDs, start times, ports and cleanup commands. Cleanup runs
after a failed startup or test too, and checks that the owned containers and
process groups are gone. It does not stop the Docker engine or any other app.
If the parent is forcibly killed, I use the printed ownership file to stop only
those resources and remove that temporary directory.

For repeatable checks that clean up automatically:

```sh
npm run typecheck
npm run test:integration
```

The integration command uses empty disposable storage, including a fresh database
password generated for that run. It never needs an Azure account. I rebuild after
editing TypeScript because Core Tools loads `dist/functions.mjs`.

For an existing local database, I can instead set `SQL_SERVER`, `SQL_DATABASE`,
`SQL_PORT`, `SQL_USER`, `SQL_PASSWORD` and `AzureWebJobsStorage` in my shell, run
`npm run publish:feed`, then `npm start`. I set
`SQL_TRUST_SERVER_CERTIFICATE=true` only for a local SQL Server's self-signed
certificate. Cloud connections validate certificates. `local.settings.json`,
`.env` files and deployment parameter files are ignored and kept out of images.

## Point the phone at it

In another terminal, from the repository root:

```sh
cd mobile
npm ci
EXPO_PUBLIC_DEMO_FEED_URL=https://MY-FUNCTION.azurewebsites.net/api/demo/today npm start
```

I restart Expo after changing that address and select **Refresh**. For a local
preview on the same computer I can use the printed localhost URL with the phone
client's browser preview. A physical phone needs a reachable HTTPS address;
its `127.0.0.1` means the phone itself. The cloud template permits browser requests
from `https://lifeos.jacklai.ca`; I add a specific preview origin in the Function
App's CORS settings when using Expo web. Native phone requests do not use browser
CORS, which is a browser rule controlling cross-site reads.

## Deploy the container on Azure

This step needs my own Azure subscription and creates billable resources. The
local tests above are enough to try the whole feed without a subscription.

Docker packages the compiled function and its runtime. From the repository root,
I build a Linux amd64 image and push it to a public container registry I control:

```sh
docker build --platform linux/amd64 -f integrations/azure-feed/Dockerfile \
  -t ghcr.io/MY-OWNER/lifeos-azure-feed:MY-TAG .
docker login ghcr.io
docker push ghcr.io/MY-OWNER/lifeos-azure-feed:MY-TAG
```

I make that registry package public before deploying. Registry credentials stay
in Docker's credential store. The image copies only the compiled read routes,
their dependencies and host settings; publishing the feed runs separately.

I install Azure CLI, sign in with `az login`, and select my subscription with
`az account set --subscription MY-SUBSCRIPTION`. My account needs permission to
create resources and assign storage roles. Bicep describes the Azure resources
in a file. After `az bicep install`, I check it without deploying:

```sh
az bicep build --file integrations/azure-feed/infra/main.bicep \
  --outfile /tmp/azure-feed-template.json
```

I set these shell variables myself: `FEED_PREFIX` (3 to 11 lowercase letters or
digits), `FEED_LOCATION` (an Azure region), `FEED_IMAGE` (the image above),
`FEED_ADMIN_ID` (my Microsoft Entra object ID), `FEED_ADMIN_LOGIN` (my account's
display name), and `FEED_PUBLISHER_IP` (my public IPv4 address). None belongs in
the repo. `az ad signed-in-user show --query id -o tsv` returns my object ID.

```sh
az group create --name lifeos-public-feed --location "$FEED_LOCATION"
az deployment group create --resource-group lifeos-public-feed --name feed \
  --template-file integrations/azure-feed/infra/main.bicep \
  --parameters namePrefix="$FEED_PREFIX" containerImage="$FEED_IMAGE" \
    sqlAdminObjectId="$FEED_ADMIN_ID" sqlAdminLogin="$FEED_ADMIN_LOGIN" \
    publisherIp="$FEED_PUBLISHER_IP"
az deployment group show --resource-group lifeos-public-feed --name feed \
  --query properties.outputs
```

The outputs give the function name, its identity, SQL server, database and feed
URL. The template creates a dedicated Linux App Service plan that keeps the
Functions container running, Azure SQL Database, and private blob storage. A
managed identity is an identity Azure gives the app, so the app needs no database
password or storage key. SQL accepts Microsoft Entra sign-ins only. Runtime
settings point to the created resources; no account-specific settings are saved
in the repository. Storage role assignments may take a few minutes to propagate.

## Initialize the cloud feed

I set `SQL_SERVER` and `SQL_DATABASE` in my shell to the deployment outputs.
I unset `SQL_USER`, `SQL_PASSWORD`, `SQL_PORT` and
`SQL_TRUST_SERVER_CERTIFICATE` from any earlier local test. The publisher uses my
Azure CLI sign-in when no SQL user is set:

```sh
cd integrations/azure-feed
npm run publish:feed
```

It applies `sql/schema.sql` and copies only the fixed authored fixture at
`public/demo/today.json`, validating and stripping fields with the same parser
as the phone. Running it again replaces the one snapshot in a transaction;
readers see a complete old or new copy. I run it again after intentionally
updating the fictional examples, not after editing a private workspace.

Using the SQL query editor in the Azure portal as the configured Entra
administrator, I open the `lifeos-demo` database and run this once, replacing the
placeholder with the function name from the deployment output:

```sql
CREATE USER [MY-FUNCTION-NAME] FROM EXTERNAL PROVIDER;
GRANT SELECT ON OBJECT::dbo.PublicDemoFeed TO [MY-FUNCTION-NAME];
```

That gives the running function permission to read only this table. It cannot
publish or migrate. I then open the feed URL and `/api/health`; both should return
HTTP 200. Before initialization, a 503 means the feed is not ready. I can inspect
`demo-health/latest.json` in the storage account to confirm the real binding ran.

The template allows my publisher IP and Azure-hosted services through the SQL
firewall. The latter is a broad network allowance, although database identity
permissions still apply. This topology is for fictional public data. For other
data I would first add private networking, monitoring and a narrower access
policy. I have validated the template locally and the runtime in CI, not deployed
it to a paid Azure subscription. To remove a deployment I own, I delete its
dedicated resource group with `az group delete --name lifeos-public-feed` after
checking the group's resources in the portal.

## Behavior and checks

`GET /api/demo/today` validates the stored document before returning the public
fields. The SQL schema checks valid JSON, `fictional: true` and schema version 1;
the handler checks dates, record shapes and time zones too. Invalid or missing
data returns 503 with `no-store` and no connection details. The endpoint never
falls back to private workspace data.

A successful response has a SHA-256 ETag, a label for that exact snapshot.
`If-None-Match` with the same label returns 304 with no body. Changed data gets a
new label and a full response. Cache lifetime is 60 seconds. Readiness validates
the same feed and exercises an actual blob output binding.

The package has five handler tests and three connection/lifecycle regression
tests. The integration suite checks eight cases:
repeatable schema/publication, database constraints, restricted SQL permissions,
actual HTTP/304 behavior, the Azurite heartbeat, missing-feed recovery, changed
snapshots, and fixture cleanup after a deliberate caller failure. The cleanup
assertions also run after every fixture use. The Azure workflow builds and typechecks the function,
compiles Bicep, runs the integration suite with Core Tools, builds the App
Service image, and runs that suite again through the image. Existing LifeOS
checks remain in their normal CI workflows.

I followed Microsoft's [Node function reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node)
and [infrastructure deployment guide](https://learn.microsoft.com/en-us/azure/azure-functions/functions-infrastructure-as-code),
and the SQL client's [connection documentation](https://tediousjs.github.io/node-mssql/).
