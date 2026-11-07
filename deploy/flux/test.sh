#!/usr/bin/env bash
set -euo pipefail
context=$1
branch=$2
image=$3
[[ "$context" == kind-* ]] || { echo 'Disposable kind contexts only' >&2; exit 1; }
[[ "$image" =~ ^ghcr.io/jackai1/lifeos-open@sha256:[a-f0-9]{64}$ ]] || { echo 'Expected a published digest' >&2; exit 1; }
# CI creates this temporary pull credential before running the test.
kubectl --context "$context" -n lifeos patch serviceaccount default --type merge -p '{"imagePullSecrets":[{"name":"ghcr-pull"}]}'
kubectl --context "$context" apply -f deploy/flux/source.yaml -f deploy/flux/lifeos.yaml
kubectl --context "$context" -n flux-system patch gitrepository lifeos --type merge -p "{\"spec\":{\"ref\":{\"branch\":\"$branch\"}}}"
# Exercise the exact image published by this CI run, without changing Git.
kubectl --context "$context" -n flux-system patch kustomization lifeos --type merge -p "{\"spec\":{\"images\":[{\"name\":\"ghcr.io/jackai1/lifeos-open\",\"newName\":\"${image%@*}\",\"digest\":\"${image#*@}\"}]}}"
flux --context "$context" reconcile kustomization lifeos --with-source --timeout=5m
kubectl --context "$context" -n lifeos rollout status deploy/lifeos --timeout=180s
actual=$(kubectl --context "$context" -n lifeos get deploy lifeos -o jsonpath='{.spec.template.spec.containers[0].image}')
[ "$actual" = "$image" ]
# A manual scale must be undone by the controller pulling the desired state.
kubectl --context "$context" -n lifeos scale deployment lifeos --replicas=0
flux --context "$context" reconcile kustomization lifeos --timeout=5m
[ "$(kubectl --context "$context" -n lifeos get deploy lifeos -o jsonpath='{.spec.replicas}')" = 1 ]
kubectl --context "$context" -n lifeos rollout status deploy/lifeos --timeout=180s
