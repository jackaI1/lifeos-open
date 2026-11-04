# AWS public demo deployment plan

The supplied Cloud/AWS brief is the specification. Work remains on `skills/aws`;
Cloudflare remains the default. Native execution follows the owner's instruction
to finish the scoped work. A fresh read-only code review checks the AWS path.

## Design and decisions

Use Terraform, ECS Fargate, an ALB and CloudFront managed HTTPS. Current AWS
documentation closes App Runner to new accounts; use the specified ECS alternate.
Public subnets avoid a NAT gateway. This is an optional paid
target, not a promise of free hosting. Serve the existing browser-only edition,
reusing its host policy and the Docker agent's root Dockerfile. Never deploy the
standalone unauthenticated workspace or an ephemeral server-side SQLite database.

Provision ECR, image-pull IAM, a one-task Fargate configuration and a narrow
GitHub OIDC release role. Bootstrap Terraform locally with operator credentials;
tag releases only push images and update the existing service. Terraform ignores
release-managed image changes. This avoids giving CI infrastructure-admin rights
or storing Terraform state in GitHub. Keep local state private and backed up.

## Tasks

1. Add real HTTP regression tests for static assets, browser bootstrap, WASM MIME,
   health, HEAD, API/auth/method denial, traversal and missing assets. Watch them
   fail, then build a Node adapter around the existing hosted Worker policy.
2. Add `infra/aws/` Terraform, mock-provider plan tests and an OIDC tag workflow.
   Validate syntax and assert least-privilege trust, bounds and image selection.
3. Document architecture, account/credential setup, bootstrap, release, cost,
   rollback and teardown in `docs/deploy-aws.md`; add README skill evidence.
4. After Docker and PostgreSQL merge, fetch/rebase origin/main, integrate the
   public-demo Docker target, re-run existing tests plus new checks, open a PR,
   link it, and merge only after CI passes. Never force-push main.

## Review focus

- Public transport must reject all API/auth routes and writes without reading bodies.
- Assets must not escape the generated root; missing assets must return 404.
- OIDC must trust only this repository's AWS release tags; releases must be on main.
- Deployment must verify the selected task revision, not accept an old stable task.
- Bootstrap and teardown must work with an initially empty ECR repository.

## Execution record

- Existing linked worktree confirmed; HEAD matches sanitized public origin/main.
- No AWS CLI, Terraform or Node on PATH; no AWS credential directory found.
- Origin push URL disabled by historical cleanup; resolve publication safety before push.
- No deployment will be attempted without credentials; finish preparation first.

- Ruling: switched from App Runner to ECS Fargate after current AWS availability
  documentation confirmed App Runner is closed to new customers. ALB/IPv4 add
  cost; documented this explicitly and retained Cloudflare as the default.

- Review: fixed task-definition read permission, which AWS requires on `*`;
  registration remains restricted to the demo family. New mock-plan assertion
  failed before the policy fix and passed after it.
