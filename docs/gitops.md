# Keeping the Kubernetes copy in sync

I use Flux to pull the deployment settings from this repository into a Kubernetes cluster. Flux checks Git for changes and brings the cluster back to the saved settings if someone changes them by hand. This is separate from the hosted browser demo and uses fictional data by default.

## Start a cluster copy

You need a Kubernetes cluster, `kubectl`, the Flux CLI, a working default storage class and access to the published `ghcr.io/jackai1/lifeos-open` image. See [the Kubernetes guide](kubernetes.md) for storage, image access and local access to the service. Choose a trusted cluster: this example does not configure public authentication, TLS or backups.

```sh
flux check --pre
flux install
kubectl apply -f deploy/flux/source.yaml -f deploy/flux/lifeos.yaml
flux reconcile kustomization lifeos --with-source
kubectl -n lifeos rollout status deployment/lifeos
kubectl -n lifeos port-forward service/lifeos 8787:8787
```

Open http://127.0.0.1:8787. Stop the port forward with Ctrl-C. `flux get sources git` and `flux get kustomizations` show the last fetched revision and health. The source tracks `main`, and the Kustomization applies `deploy/kubernetes/base` every five minutes with pruning enabled. Removing a tracked resource from Git can delete it from the cluster; back up data and review changes first. The persistent volume's lifecycle depends on the cluster storage policy.

The base uses the `main` image tag. Publishing a new image with the same tag alone does not restart a running pod. For repeatable upgrades, review and commit a specific image digest in an overlay, then point the Flux Kustomization at it; rolling back means committing the previous digest. This example does not automatically promote images or configure Flux to write to Git. Never put real data or credentials in this repository.

## What CI checks

The Kubernetes workflow builds and publishes an image, creates a disposable kind cluster, installs Flux, and points its Git source at the tested branch. The test temporarily selects that run's image digest in the Flux object, waits for reconciliation and rollout, then changes the replica count by hand and checks that Flux restores it to one. The CI-only image override is not committed or a production promotion mechanism. The existing smoke test checks the app's health and persistence before this Flux test. The workflow deletes its cluster at the end.
