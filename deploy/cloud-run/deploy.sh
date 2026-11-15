#!/usr/bin/env bash
# Deploy or roll back the LifeOS demo on Cloud Run.
#   deploy/cloud-run/deploy.sh deploy <image-tag>      render the service file and deploy that image
#   deploy/cloud-run/deploy.sh rollback <revision>     send 100% of traffic back to an earlier revision
#   deploy/cloud-run/deploy.sh revisions               list the revisions that exist
# Required environment: GCP_PROJECT_ID, GCP_REGION, ARTIFACT_REPOSITORY, PARENT_ORIGIN_SECRET.
# Optional: CLOUD_RUN_SERVICE (default lifeos-demo). Nothing secret is printed or stored here.
set -euo pipefail

usage() { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
require() { [ -n "${!1:-}" ] || { echo "Set $1 first." >&2; exit 2; }; }

command -v gcloud >/dev/null || { echo "Install the Google Cloud CLI (gcloud) first." >&2; exit 2; }
require GCP_PROJECT_ID
require GCP_REGION
require ARTIFACT_REPOSITORY
require PARENT_ORIGIN_SECRET

SERVICE="${CLOUD_RUN_SERVICE:-lifeos-demo}"
HERE="$(cd "$(dirname "$0")" && pwd)"
COMMON=(--project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet)

case "${1:-}" in
  deploy)
    [ -n "${2:-}" ] || usage
    IMAGE="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/$ARTIFACT_REPOSITORY/lifeos-demo:$2"
    # The secret must exist before Cloud Run can read it; fail early with a clear message.
    gcloud secrets describe "$PARENT_ORIGIN_SECRET" --project "$GCP_PROJECT_ID" >/dev/null 2>&1 \
      || { echo "Secret $PARENT_ORIGIN_SECRET is missing. Create it with: gcloud secrets create $PARENT_ORIGIN_SECRET --data-file=-" >&2; exit 2; }
    RENDERED="$(mktemp "${TMPDIR:-/tmp}/lifeos-service.XXXXXX.yaml")"
    trap 'rm -f "$RENDERED"' EXIT
    sed -e "s|__SERVICE__|$SERVICE|g" -e "s|__IMAGE__|$IMAGE|g" -e "s|__PARENT_ORIGIN_SECRET__|$PARENT_ORIGIN_SECRET|g" \
      "$HERE/service.template.yaml" > "$RENDERED"
    gcloud run services replace "$RENDERED" "${COMMON[@]}"
    # The demo is public: allow anonymous visitors to invoke it. Re-running this is harmless.
    gcloud run services add-iam-policy-binding "$SERVICE" --member=allUsers --role=roles/run.invoker "${COMMON[@]}" >/dev/null
    gcloud run services describe "$SERVICE" --format='value(status.url,status.latestReadyRevisionName)' "${COMMON[@]}"
    ;;
  rollback)
    [ -n "${2:-}" ] || usage
    gcloud run services update-traffic "$SERVICE" --to-revisions="$2=100" "${COMMON[@]}"
    ;;
  revisions)
    gcloud run revisions list --service "$SERVICE" --format='table(metadata.name,status.conditions[0].status,metadata.creationTimestamp)' "${COMMON[@]}"
    ;;
  *) usage ;;
esac
