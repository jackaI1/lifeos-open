# Optional AWS deployment: browser-only demo

Cloudflare remains the default public host. This second target uses Terraform,
ECS Fargate and CloudFront HTTPS. AWS deployment is prepared, not certified live:
an AWS account and local bootstrap credentials are required. Nothing deploys on
a normal main-branch push. App Runner was considered, but [AWS has closed it to
new customers](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html),
so this target uses the brief's ECS alternative.

## Architecture

```text
aws-v* tag on main -> GitHub Actions -> AWS STS via GitHub OIDC
  -> shared Dockerfile public-demo target -> private ECR immutable image
  -> new ECS task revision -> one Fargate task

Browser --HTTPS--> CloudFront --HTTP--> ALB --HTTP:8080--> static container
  -> browser worker + SQLite WASM + visitor-local IndexedDB
```

- [`infra/aws/`](../infra/aws/) owns the registry, IAM/OIDC, ECS cluster/task/service,
  seven-day CloudWatch logs, dedicated VPC, two public subnets, ALB and CloudFront.
  The AWS-generated `cloudfront.net` domain has managed HTTPS; no custom domain,
  ACM certificate or change to the existing Cloudflare host is necessary.
- CloudFront redirects viewers to HTTPS. Its origin connection is HTTP inside
  this design; this is not end-to-end TLS. The ALB admits only CloudFront's
  managed origin-facing IP prefix list. Tasks admit port 8080 only from the ALB's
  security group. A task has a public IP for HTTPS image/log egress, with no
  direct inbound access. There is no NAT gateway, RDS, visitor database or app IAM
  task role. The execution role only pulls this image and writes this log group.
- [`src/hosted/server.mjs`](../src/hosted/server.mjs) reuses the existing
  [`src/hosted/worker.ts`](../src/hosted/worker.ts) static security policy. Only
  generated public assets are served. API/auth routes and non-GET/HEAD methods
  are denied, request bodies/cookies are unused, and `/healthz` checks readiness.
  The root Dockerfile's `public-demo` target contains only those assets and host
  modules. Never deploy the local workspace target as an unauthenticated public API.
- One 0.25-vCPU / 0.5-GB task runs with a read-only root filesystem. Deployments
  stop the old task before starting its replacement to keep at most one task;
  expect brief downtime. ECS circuit-breaker rollback is enabled.
- OIDC trusts only this repository's `aws-v*` tags and audience `sts.amazonaws.com`.
  The release role pushes to this ECR repository, registers this task family,
  updates this service and passes only its execution role. It cannot administer
  IAM, networks or other apps. ECR authorization and ECS task-definition description require wildcard
  resources; writes, repository operations and service updates remain scoped.

Visitor records stay in that browser. The Cloudflare origin, this AWS origin and
other devices have separate storage; there is no migration or reset. Export
before clearing site data. No private database, upload folder, provider key or
application environment file belongs in the image. CloudFront/ALB access logs
are not enabled. Standard ECS service metadata and seven-day container logs exist.
The CloudFront IP allowlist permits CloudFront generally; it is not authentication
for one distribution. The origin is intentionally a public static application.

## Cost and scope

This is an **optional paid demonstration**, not a promise of free hosting.
Fargate, ALB, public IPv4 addresses, ECR, CloudWatch and traffic can incur charges.
CloudFront and account credits may have Free Tier allowances; eligibility varies.
Review current [Fargate](https://aws.amazon.com/fargate/pricing/),
[ALB](https://aws.amazon.com/elasticloadbalancing/pricing/),
[public IPv4](https://aws.amazon.com/vpc/pricing/) and
[CloudFront](https://aws.amazon.com/cloudfront/pricing/) pricing before applying.
The ALB can cost more than the small task. One task, no NAT gateway, five retained
images, seven-day logs and CloudFront PriceClass_100 limit some costs; they do not
cap traffic or total spend. Create a small AWS Budget alert before deployment.
Alerts do not enforce a hard cap. Keep Cloudflare as the usual host and destroy
this target after the demonstration.

## Jack: set up credentials locally

1. Create an AWS account if needed, protect the root account with MFA and create
   an operator identity. Do not send keys in chat or commit credentials.
2. Install AWS CLI v2, Terraform 1.7+ (CI uses 1.14.0), Docker with Linux builds,
   Node 24 and GitHub CLI. Authenticate locally:

   ```sh
   aws configure sso --profile lifeos-demo
   aws sso login --profile lifeos-demo
   export AWS_PROFILE=lifeos-demo
   export AWS_REGION=us-east-1
   aws sts get-caller-identity
   ```

   For an account using IAM access keys instead of Identity Center, use
   `aws configure --profile lifeos-demo` locally instead. Never use root keys.
   GitHub receives short-lived OIDC credentials, not these bootstrap keys.
3. The operator needs bootstrap rights to manage the dedicated ECR, ECS, IAM/OIDC,
   VPC/security groups, ELB, CloudFront and log resources and to pass the execution
   role. First-time ECS/ELB use may create service-linked roles. Have the account
   administrator grant bootstrap access; the CI release role has fewer permissions.

## Bootstrap from the repository root

Keep local Terraform state and account-specific tfvars private and backed up
outside the checkout. They are ignored. Do not store state in CI artifacts. A
team should configure an encrypted, versioned remote backend with locking before
collaborating; this release workflow does not run Terraform.

```sh
cp infra/aws/terraform.tfvars.example infra/aws/terraform.tfvars
# Edit parent_origin to the exact HTTPS portfolio origin, without a trailing slash.
# If GitHub OIDC already exists in this account, set existing_oidc_provider_arn.
terraform -chdir=infra/aws init
terraform -chdir=infra/aws plan -out=bootstrap.tfplan
terraform -chdir=infra/aws apply bootstrap.tfplan
```

The initial `image_tag = null` creates ECR/IAM/cluster/log configuration, without
billable compute, ALB or a distribution attempting an empty image. Build and push
from a verified main commit using the shared Dockerfile:

```sh
git fetch origin
git merge-base --is-ancestor HEAD origin/main
export ECR_REPOSITORY_URL=$(terraform -chdir=infra/aws output -raw repository_url)
export IMAGE_TAG=aws-$(git rev-parse HEAD)
registry=${ECR_REPOSITORY_URL%%/*}
aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "$registry"
docker build --platform linux/amd64 --target public-demo \
  -t "$ECR_REPOSITORY_URL:$IMAGE_TAG" .
docker push "$ECR_REPOSITORY_URL:$IMAGE_TAG"
```

Set `image_tag = "aws-<the full commit SHA you pushed>"` in the ignored tfvars.
Keep this non-null on subsequent operations: removing it plans to destroy the
service/network/distribution. Then provision the HTTPS target:

```sh
terraform -chdir=infra/aws plan -out=service.tfplan
terraform -chdir=infra/aws apply service.tfplan
terraform -chdir=infra/aws output demo_url
```

CloudFront provisioning can take several minutes. The `PARENT_ORIGIN` task
environment comes from Terraform, without needing the generated hostname.
The placeholder `.invalid` parent permits standalone viewing; set a real value
only if that portfolio needs to embed this origin. No DNS changes are necessary.

## GitHub OIDC releases

Protect `aws-v*` tags with a GitHub ruleset that lets only the release owner create
or update them. The workflow also checks that the tag commit belongs to main.
There is intentionally no job environment: adding one changes the OIDC subject
and requires updating the trust policy. See [GitHub's AWS OIDC guide](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).

Configure six non-secret repository variables after provisioning:

```sh
gh variable set AWS_REGION --repo jackaI1/lifeos-open --body "$AWS_REGION"
gh variable set AWS_ROLE_ARN --repo jackaI1/lifeos-open \
  --body "$(terraform -chdir=infra/aws output -raw release_role_arn)"
gh variable set AWS_ECR_REPOSITORY_URL --repo jackaI1/lifeos-open \
  --body "$(terraform -chdir=infra/aws output -raw repository_url)"
gh variable set AWS_ECS_CLUSTER --repo jackaI1/lifeos-open \
  --body "$(terraform -chdir=infra/aws output -raw cluster_name)"
gh variable set AWS_ECS_SERVICE --repo jackaI1/lifeos-open \
  --body "$(terraform -chdir=infra/aws output -raw service_name)"
gh variable set AWS_DEMO_URL --repo jackaI1/lifeos-open \
  --body "$(terraform -chdir=infra/aws output -raw demo_url)"
```

Create a new `aws-v0.1.0` tag on a verified main commit through GitHub Releases.
For clones whose pre-push policy permits release tags, the equivalent is:

```sh
git tag aws-v0.1.0 <verified-main-commit>
git push public refs/tags/aws-v0.1.0
```

Do not change or bypass a local pre-push guard that allows only `skills/*`; use the
Releases UI instead. Merging this infrastructure does not create a release tag.

[The tag workflow](../.github/workflows/deploy-aws.yml) fails before requesting
credentials if configuration is incomplete. It tests the code, assumes the OIDC
role, builds `public-demo` for Linux amd64 and pushes an immutable `aws-<commit SHA>`
image. Retry runs reuse an existing image. [The release driver](../tools/deploy-aws.mjs)
clones the service's active task definition, replaces only the image and registers
a new revision. It verifies that exact revision becomes primary, completed and
healthy, rather than accepting an old stable deployment. Failures/rollback and a
15-minute timeout are reported. HTTPS bootstrap/API/write checks follow.

Terraform owns infrastructure and the bootstrap task template; it ignores the
service's release-managed task revision. For runtime configuration changes, set
`image_tag` to the currently deployed image in private tfvars, apply the updated
template, then explicitly roll out its `task_definition_arn` with `aws ecs
update-service --cluster <cluster> --service <service> --task-definition <arn>`.
Inspect and verify that rollout before the next release. This prevents an
unrelated Terraform apply from silently reverting an image release.

For rollback, create a new `aws-v*` tag on a known-good main commit whose ECR
image is retained. Only five images are retained; confirm the desired and active
images are still present before relying on rollback, especially after failed
releases. A timed-out deployment requires inspecting ECS service events first.

## Verification

Without an AWS account:

```sh
npm ci
npm test
npm run build
npm run lint
npm run typecheck
npm run privacy
terraform -chdir=infra/aws init -backend=false -input=false -lockfile=readonly
terraform -chdir=infra/aws fmt -check -recursive
terraform -chdir=infra/aws validate
terraform -chdir=infra/aws test
```

Terraform tests use a mocked provider and create no AWS resources. [AWS CI](../.github/workflows/aws-infra.yml)
also builds the actual Docker target and tests one disposable container over HTTP,
with an exit cleanup trap. [Host regressions](../test/aws-static-host.test.mjs)
cover bootstrap/CSP, WASM MIME, HEAD, API/auth/write denial, traversal/symlinks,
readiness and origin validation. [Release regressions](../test/aws-release.test.mjs)
cover selecting the new task revision, preserving configuration, failure and timeout.

After deployment, open the HTTPS URL, edit a fictional record and reload. Confirm
persistence in that browser, isolation in a fresh profile, and absence of server
API writes in DevTools. Record the URL, commit, successful workflow and these
checks before claiming live AWS use.

## Teardown

Use the same operator profile, region, tfvars and state. Terraform owns the
service, load balancer, distribution, networking, log group and dedicated roles.
A reused account OIDC provider is not deleted. ECR deliberately refuses to delete
while images remain; review and remove only this dedicated demo's images first:

```sh
export AWS_PROFILE=lifeos-demo
export AWS_REGION=us-east-1
repository=$(terraform -chdir=infra/aws output -raw repository_url)
repository=${repository#*/}
aws ecr list-images --repository-name "$repository" --region "$AWS_REGION"
# Repeat for every reviewed digest in this dedicated repository:
aws ecr batch-delete-image --repository-name "$repository" \
  --image-ids imageDigest=sha256:REVIEWED_DIGEST --region "$AWS_REGION"
terraform -chdir=infra/aws plan -destroy -out=destroy.tfplan
terraform -chdir=infra/aws apply destroy.tfplan
```

CloudFront disable/delete may take several minutes. Remove the six GitHub
variables to disable future releases. Confirm this service has disappeared from
ECS, its ALB and CloudFront distribution are gone, its ECR repository/log group
are absent and its dedicated VPC has no remaining interfaces. Release-created
ECS task revisions are outside Terraform: list only this task family, deregister
its remaining active revisions with `aws ecs deregister-task-definition`, and
optionally delete inactive revisions with `aws ecs delete-task-definitions`.
Those inert revisions do not run tasks or retain images, but deregistering them
completes the metadata cleanup. Preserve shared service-linked roles and other
apps. Keep private state backups until teardown is confirmed. There is no
server-side visitor database to remove.
