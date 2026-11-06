# Run LifeOS in a small cluster

I wanted a repeatable way to run the standalone workspace on a cluster I already
control, without losing my notes when the app is replaced. Kubernetes keeps the
app running and connects it to a separate disk. This setup runs one copy of the
workspace and keeps the same SQLite database file across app updates.

This is an optional way to run LifeOS. The local Node and Compose commands in the
README are simpler for one laptop. The cluster starts with fictional records and
scripted assistant replies, needs no provider keys, and has no public web address.
I reach it through a local tunnel. Anyone with access inside the cluster can reach
the demo service, so I use a cluster I control and keep personal records out of it.

## Start with kind

Install Docker, kubectl (the cluster command-line tool), and kind (a small local
Kubernetes cluster running in Docker). Docker must be running. The local build works on both Intel/AMD and Apple Silicon machines; CI also
publishes both image versions.

On macOS, after installing and starting Docker:

```sh
brew install kind kubernetes-cli kubeconform
```

From this repository:

```sh
docker build --target runtime -t lifeos-open:kind .
kind create cluster --name lifeos --image kindest/node:v1.35.8@sha256:07b2536e30b803ed61d1677a79df6115f798ce64c80f9e22f6ed45afd09323c0
kind load docker-image lifeos-open:kind --name lifeos
kubectl --context kind-lifeos apply -k deploy/kubernetes/overlays/kind
kubectl --context kind-lifeos -n lifeos rollout status deployment/lifeos --timeout=240s
kubectl --context kind-lifeos -n lifeos port-forward --address 127.0.0.1 service/lifeos 8787:8787
```

Open <http://127.0.0.1:8787>, use **Notes** to save a note, and leave the tunnel
command running while using the workspace. Stop that command with Ctrl-C when
finished. Use port 8787 on both sides: the app checks the request's host and origin
against that address. No credentials are needed for this fictional workspace.

The kind overlay uses the image I just built and loaded into the cluster. It does
not need registry access. For local upgrades, build and load a **new, unique tag**,
then render the kind overlay with that image and apply it:

```sh
docker build --target runtime -t lifeos-open:upgrade-1 .
kind load docker-image lifeos-open:upgrade-1 --name lifeos
node tools/kubernetes-render.mjs kind lifeos-open:upgrade-1 | kubectl --context kind-lifeos apply -f -
kubectl --context kind-lifeos -n lifeos rollout status deployment/lifeos --timeout=240s
```

Keep the old
loaded image and tag until rollback is no longer needed. Rebuilding the same tag
does not preserve the earlier app for rollback.

For a published image, select the exact digest from a successful
**Kubernetes → Build and publish standalone image** Actions step. A digest is the
image's content fingerprint, so it identifies the same package each time. The
published registry package can require authentication even though this repository
is public. Create a `ghcr-pull` secret in the target namespace with a GitHub token
that has `read:packages` access to the package, then use `overlays/ci` below. Keep
the token outside the repository:

```sh
kubectl --context kind-lifeos create namespace lifeos --dry-run=client -o yaml | kubectl --context kind-lifeos apply -f -
# Set GHCR_TOKEN in the shell without putting its value in a file or command history.
kubectl --context kind-lifeos -n lifeos create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io --docker-username=YOUR_GITHUB_LOGIN --docker-password="$GHCR_TOKEN"
unset GHCR_TOKEN
```

```sh
# Replace the placeholder with the sha256 value printed by that successful build.
IMAGE='ghcr.io/jackai1/lifeos-open@sha256:REPLACE_WITH_IMAGE_DIGEST'
node tools/kubernetes-render.mjs ci "$IMAGE" | kubectl --context kind-lifeos apply -f -
kubectl --context kind-lifeos -n lifeos rollout status deployment/lifeos --timeout=240s
```

For an existing cluster, use `deploy/kubernetes/base` instead of the kind overlay
and select its context explicitly. Its default image is the published `main` tag;
select a digest before the first upgrade, and add `imagePullSecrets` in an overlay
if registry authentication is needed. The base requests that cluster's default
storage class, the rule that allocates a disk. The kind overlay selects kind's
`standard` storage class. A cluster without a default needs a local overlay with
its own storage class before applying. Check the claim with
`kubectl --context kind-lifeos -n lifeos get pvc` if startup waits for storage.

## Update and roll back

Before an update, open **Settings → Data & recovery → Create a verified backup**
and download it somewhere outside the cluster. A persistent disk is not a backup.
Record the current revision and image, then apply the new digest using the commands
above:

```sh
kubectl --context kind-lifeos -n lifeos rollout history deployment/lifeos
kubectl --context kind-lifeos -n lifeos get deployment lifeos -o jsonpath='{.spec.template.spec.containers[0].image}'
```

Updates briefly stop the workspace. Once rollout succeeds, restart the tunnel
if it disconnected, open the page and check a saved note. If the new app does not
start or behaves incorrectly, choose a previous revision shown by history:

```sh
# Use the revision number recorded before the update.
kubectl --context kind-lifeos -n lifeos rollout undo deployment/lifeos --to-revision=1
kubectl --context kind-lifeos -n lifeos rollout status deployment/lifeos --timeout=240s
```

This restores the earlier pod template, including its image reference and generated
settings reference. A digest or unique retained local tag is needed to restore the
same app bytes; undo cannot recover an older image behind a reused mutable tag. It keeps the disk. It does **not** reverse database migrations; use a
compatible image or restore the verified backup into a separate workspace if the
database format changed. Keep the old generated ConfigMaps while rollback is
needed: ordinary `apply` leaves them in place. Applying the newer overlay again
would reapply its image and settings, so update the overlay to the chosen version
before the next deployment.

## How the pieces fit

- `deploy/kubernetes/base/deployment.yaml` describes one running app copy. Its
  `Recreate` update rule stops the old copy first, avoiding simultaneous SQLite
  writers during a managed update. Do not scale it up or force-delete its pod.
- `storage.yaml` requests a 1 GiB persistent volume, a disk kept separately from
  the pod, mounted at `/data`. SQLite stores records and uploaded file contents
  there. `ReadWriteOnce` restricts attachment to one node; it does not itself
  enforce one writer. The replica count and rollout strategy provide that part.
- `service.yaml` gives the pod a stable internal address. It is `ClusterIP`, so
  this setup does not create a public port or load balancer.
- `kustomization.yaml` generates a ConfigMap, a set of non-secret app settings.
  Its content hash changes the pod template when settings change. Kustomize
  combines the base with the small kind-specific storage patch.
- Startup checks allow up to two minutes for initial setup. Readiness controls
  whether the Service sends traffic to the pod; liveness restarts an unresponsive
  app. All three call `/api/health`, which reads SQLite, with the loopback `Host`
  header required by LifeOS. This shared health check does not diagnose every
  possible failure separately.
- The process runs as user 1000 with matching disk group permissions, a read-only
  root filesystem, no extra Linux capabilities and no cluster API token. CPU is
  limited to one core and memory to 512 MiB, with smaller scheduling requests.

This is a single workspace with update downtime, not a highly available service.
The 1 GiB disk needs monitoring and backups for longer use. kind's disk lives
inside its Docker node and is lost when the cluster is deleted. A shared or public
service needs a separate authentication and network design; this demo configuration
should stay on a trusted cluster.

## Repeat the checks

After `npm ci`, install kubectl and kubeconform, then run:

```sh
npm run test:kubernetes
```

Eight checks render all three configurations, validate all five objects in each with
strict Kubernetes 1.35 schemas, reject a deliberately invalid field, and check
that storage, settings, selectors and probes agree. An image-override check also
proves that selecting an exact release preserves the complete resource bundle. Missing tools or schemas fail
the command. `npm test` also exercises the smoke check against a real SQLite file
across two fresh application sessions, including a missing-note failure.

The [Kubernetes workflow](../.github/workflows/kubernetes.yml) publishes the real
standalone image to GitHub Container Registry. Trusted repository PRs and main
then create a fresh kind cluster and pull that image by digest, without loading a
local build. A temporary image-pull secret uses that job's GitHub token, is supplied
only at runtime and disappears with the cluster. Fork PRs run schema
validation and the existing Docker build without publishing. Tagged image releases
in the existing Docker workflow keep their previous behavior.

CI checks health, the workspace page and unexpected-host rejection through the
internal Service, saves a fictional note through the API, replaces the pod and
checks that same note. It also rolls back the pod revision and checks the note
again. It deletes its named cluster on success or failure and verifies that the
cluster's Docker containers are gone. To repeat that destructive test on a
**disposable** kind cluster with a published digest and the `ghcr-pull` secret
created as above:

```sh
bash deploy/kubernetes/smoke.sh kind-lifeos "$IMAGE"
```

The script intentionally writes a uniquely named fictional note. It refuses
non-kind contexts and image tags. It does not create or delete the cluster;
its caller owns that lifecycle. The test makes no claims about managed cloud
storage or real-user load.

## Stop and remove

Stop any port-forward command with Ctrl-C. To stop the app and preserve its claim:

```sh
kubectl --context kind-lifeos -n lifeos scale deployment/lifeos --replicas=0
```

Run the apply command again to start it. Removing the namespace also removes its
claim and may delete the underlying volume, depending on its reclaim policy.
After downloading any backup I need, I can remove the entire disposable cluster:

```sh
kind delete cluster --name lifeos
kind get clusters
```

The `lifeos` cluster should no longer appear. Do not delete a cluster holding the
only copy of records I want to keep.
