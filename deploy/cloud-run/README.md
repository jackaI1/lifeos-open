# Deploying the LifeOS demo to Cloud Run

I built a deploy pipeline for the public LifeOS demo because the demo needed a stable public
address that does not depend on my laptop being on. Google Cloud Run runs the demo's Docker image
as a web service. Cloud Run is a Google service that starts a container when a visitor arrives,
scales it up or down, and gives it an HTTPS address.

## What happens when I release it

1. I create a version tag such as `v0.2.0` and push it to GitHub.
2. GitHub Actions builds the demo image from the repository `Dockerfile` (the `public-demo` target).
3. The same image is started on a test machine, and the check asks for `/healthz`. If that does not
   answer with `"status":"ok"`, nothing is deployed.
4. Only after those tests pass does the deploy job push the image to Artifact Registry (Google's
   container storage) and tell Cloud Run to use it.

GitHub signs in to Google with a short-lived token (Workload Identity Federation). No Google
password or service-account key file is stored in the repository or in GitHub secrets.

## Where the settings live

The demo's one runtime setting, `PARENT_ORIGIN`, is kept in Google Secret Manager, not in the
code. Cloud Run reads it when a new revision starts. Only the secret's name is written in this
folder.

| What | Where it lives |
| --- | --- |
| Google project, region, image repository | GitHub repository variables (not secret) |
| Name of the Secret Manager secret | GitHub repository variable `PARENT_ORIGIN_SECRET` |
| Value of `PARENT_ORIGIN` | Secret Manager |
| Deploy identity | A Google service account with only the Cloud Run and Artifact Registry roles |

## One-time setup (about 15 minutes)

These steps need a Google Cloud project with billing turned on. A free trial credit is enough.

```sh
export GCP_PROJECT_ID=your-project-id
export GCP_REGION=northamerica-northeast1
gcloud config set project "$GCP_PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com
gcloud artifacts repositories create lifeos --repository-format=docker --location="$GCP_REGION"
printf '%s' 'https://owner.example.invalid' | gcloud secrets create lifeos-demo-parent-origin --data-file=-
```

Replace the example origin with the real owner origin before the first release. Then, in GitHub
under **Settings → Secrets and variables → Actions → Variables**, set:

- `GCP_PROJECT_ID`, `GCP_REGION`, `ARTIFACT_REPOSITORY` (`lifeos`)
- `PARENT_ORIGIN_SECRET` (`lifeos-demo-parent-origin`)
- `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT` (created with Google's
  "Workload Identity Federation for GitHub" guide, limited to this repository)

Until `GCP_PROJECT_ID` is set, the deploy job is skipped and the test job still runs.

## Release a new version

```sh
git tag v0.2.0
git push public v0.2.0
```

The workflow file is `.github/workflows/cloud-run.yml`. Its run shows the revision name and the
service URL at the end of the deploy step.

## Roll back

If a new revision misbehaves, send all traffic back to the one before it. I can do this from the
command line:

```sh
deploy/cloud-run/deploy.sh revisions                       # find the revision name to go back to
deploy/cloud-run/deploy.sh rollback lifeos-demo-00007-abc  # replace with the revision you want
```

Or run the **Cloud Run demo** workflow by hand, choose `rollback`, and type the revision name.
A rollback changes only traffic. It does not delete the newer revision, so I can look at it later.

## Check it

```sh
deploy/cloud-run/smoke.sh   # builds the image and checks /healthz on this machine (needs Docker)
curl -fsS "$(gcloud run services describe lifeos-demo --region "$GCP_REGION" --format='value(status.url)')/healthz"
```

## Files

- `service.template.yaml`: the Cloud Run service. It sets the `/healthz` startup and liveness
  probes, port 8080, and the secret.
- `deploy.sh`: fills in the template, checks that the secret exists, deploys, and handles rollback.
- `smoke.sh`: the image check that runs in GitHub Actions before any deploy.
- `../../test/cloud-run-deploy.test.mjs`: checks the template, the workflow order and the health route.

## Limits

The demo has no database and no login on its public host. Cloud Run's free allowance and the
scaling limit in the template (two instances at most) keep the cost small, but a traffic spike
can still use up the free allowance. The Cloud Run and Artifact Registry costs appear on the
Google billing page.
