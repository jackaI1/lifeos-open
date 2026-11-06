#!/usr/bin/env bash
# Disposable kind clusters only. The caller owns cluster creation and deletion.
set -euo pipefail
context=${1:?Usage: smoke.sh kind-CONTEXT ghcr.io/jackai1/lifeos-open@sha256:DIGEST}
image=${2:?Pass the published image digest}
[[ "$context" == kind-* ]] || { echo 'Refusing to mutate a non-kind context' >&2; exit 1; }
[[ "$image" =~ ^ghcr.io/jackai1/lifeos-open@sha256:[a-f0-9]{64}$ ]] || { echo 'An immutable published image digest is required' >&2; exit 1; }
root=$(cd "$(dirname "$0")/../.." && pwd)
k() { kubectl --context "$context" --namespace lifeos "$@"; }
# Render the exact image before the first apply, keeping all five objects.
node "$root/tools/kubernetes-render.mjs" ci "$image" | k apply -f -
k rollout status deployment/lifeos --timeout=240s
[[ "$(k get deployment lifeos -o jsonpath='{.spec.template.spec.containers[0].image}')" == "$image" ]]
[[ "$(k get pvc lifeos-data -o jsonpath='{.status.phase}')" == Bound ]]
id="kubernetes-smoke-$(date +%s)-$$"
check() { k exec -i deployment/lifeos -- node --input-type=module - "$1" "$id" < "$root/tools/kubernetes-api-smoke.mjs"; }
check write
old_uid=$(k get pod -l app.kubernetes.io/name=lifeos -o jsonpath='{.items[0].metadata.uid}')
revision=$(k get deployment lifeos -o jsonpath='{.metadata.annotations.deployment\.kubernetes\.io/revision}')
# Exercise the same safe rollout as an upgrade, including a new pod identity.
k rollout restart deployment/lifeos
k rollout status deployment/lifeos --timeout=180s
[[ "$(k get pod -l app.kubernetes.io/name=lifeos -o jsonpath='{.items[0].metadata.uid}')" != "$old_uid" ]]
check verify
# Undo to the first pod template and prove that SQLite is still readable.
k rollout undo deployment/lifeos --to-revision="$revision"
k rollout status deployment/lifeos --timeout=180s
check verify
k exec deployment/lifeos -- test -s /data/workspace.sqlite
printf 'PASS: published image, bound PVC, health, Service, saved note, replacement pod and rollback\n'
