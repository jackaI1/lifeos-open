# My optional public hosting templates

I built separate hosting templates because I wanted to learn how the fictional
LifeOS browser demo could run on other hosts. The normal live demo remains at
<https://lifeos.jacklai.ca>. I have not provisioned either option here, and these
files do not establish a live AWS or Azure deployment.

Only the browser-only demo is packaged. Private notes, credentials and workspace
volumes are excluded. The Next.js study desk and practice services are not part
of either deployment.

## A small AWS static host

`infra/aws-static/template.yaml` defines a private S3 bucket, CloudFront HTTPS
serving, signed origin access and a release role restricted to this repository's
main branch. S3 keeps static files; CloudFront caches them nearer visitors. This
avoids the continuously running ECS service in the separate
[AWS container guide](deploy-aws.md).

With an existing AWS account, AWS CLI and a GitHub OIDC provider in that account:

```sh
aws cloudformation deploy --stack-name lifeos-public-static \
  --template-file infra/aws-static/template.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides GitHubOidcProviderArn=arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com
aws cloudformation describe-stacks --stack-name lifeos-public-static --query 'Stacks[0].Outputs'
```

Copy those outputs to repository variables `AWS_STATIC_ROLE_ARN`,
`AWS_STATIC_BUCKET`, `AWS_STATIC_DISTRIBUTION` and `AWS_STATIC_URL`.
The `Optional AWS static release` workflow starts after successful main CI,
repeats checks, builds the browser assets for that HTTPS origin, uploads them
and invalidates the cache. OIDC is GitHub's short-lived identity token, so there
are no stored AWS keys. `/healthz` contains the deployed commit; the smoke test
waits for that exact version and verifies the shell and denied server API path.
GitHub environment `aws-public-demo` can restrict releases further.
Without the variables, the release job stays disabled. Template lint runs on
ordinary pull requests without an account.

To roll back, rerun the workflow from a reviewed earlier main revision by
reverting its change through a PR, then let CI publish that revision. S3
versioning retains earlier objects for manual recovery. This static host uses
CloudFront's own domain, not the existing demo's DNS. The browser data remains
on each visitor's device and is not in S3.

Free-tier eligibility depends on the account and current AWS terms. This setup
has no always-on compute, but storage, requests, cache invalidations and retained
versions can still cost money. Set an account budget and review free-tier
allowances before provisioning; I have not measured a live bill. For teardown,
clear the four GitHub variables, delete the CloudFormation stack, then review
and delete all object versions in its retained dedicated bucket before deleting
the bucket. The template intentionally retains that bucket during stack deletion.
Preserve unrelated buckets and the shared OIDC provider.

## Azure Container Apps

`infra/azure-demo/main.bicep` creates a dedicated resource group.
`resources.bicep` defines the registry, Container Apps environment, Log Analytics
workspace, a user-assigned managed identity and its AcrPull role. Container Apps
serves HTTPS on port 8080 and can scale to zero. The registry's admin password
is disabled. A managed identity lets the app pull its image without a password.
The [Azure image-pull guide](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull)
explains that role connection.

With Azure CLI and an existing subscription:

```sh
az login
az account set --subscription SUBSCRIPTION_ID
az bicep build --file infra/azure-demo/main.bicep --outfile /tmp/azure-demo.json
python3 tools/check-azure-demo.py /tmp/azure-demo.json
az deployment sub what-if --location canadacentral --template-file infra/azure-demo/main.bicep
```

For GitHub, create an Entra application and service principal, then federated
credentials for the `azure-public-demo` environment and, for the preview job,
`repo:jackaI1/lifeos-open:pull_request`. Give the deployment principal Contributor
and Role Based Access Control Administrator only in the dedicated resource group;
provision that group first and use a subscription deployment permission scoped to
this template's resource-group creation if automated provisioning is required.
Review least privilege for the subscription-level deployment with the operator.
Never grant access to the private LifeOS resources. Use the official
[OIDC login instructions](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)
to create the federated identity without a client secret.

Set repository variables `AZURE_DEMO_CLIENT_ID`, `AZURE_DEMO_TENANT_ID` and
`AZURE_DEMO_SUBSCRIPTION_ID`. The workflow always compiles Bicep and checks the
compiled resources. With those variables configured, same-repository PRs run
`what-if`, a preview of resource changes. Fork PRs cannot request that identity.
Main deploys the foundation first, builds the existing Dockerfile's `public-demo`
target in ACR, then deploys the app using that commit's image tag and checks
`/healthz`. The foundation phase sets `deployApp=false` so an empty registry is
usable on the first deployment. Main releases use the protected GitHub environment.

These templates and compile checks need no Azure account. Live what-if, role
propagation, image deployment and HTTPS checks require the configured subscription
and have not been exercised here. ACR Basic and log ingestion can cost money even
when the app scales to zero; this is not a guaranteed free deployment. Set budget
alerts, keep one replica at most, and avoid creating a paid account just for this
example. To roll back, redeploy with the earlier `imageTag`. To tear down, disable
the GitHub variables, review the dedicated group, then run
`az group delete --name lifeos-public-study --yes` and confirm it is gone.
Delete only this app's federated credentials and role assignments afterward.
