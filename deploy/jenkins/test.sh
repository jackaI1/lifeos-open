#!/usr/bin/env bash
# Disposable integration test. Run from the repository root on a Docker host.
set -euo pipefail
export LIFEOS_JENKINS_REF="${LIFEOS_JENKINS_REF:-$(git rev-parse HEAD)}"
export JENKINS_ADMIN_PASSWORD="${JENKINS_ADMIN_PASSWORD:-$(openssl rand -hex 24)}"
export JENKINS_PORT="${JENKINS_PORT:-18081}"
export JENKINS_URL="http://127.0.0.1:$JENKINS_PORT"
export JENKINS_DOCKER_GID="${JENKINS_DOCKER_GID:-$(stat -c %g /var/run/docker.sock)}"
project="lifeos-jenkins-test-$(openssl rand -hex 4)"
export LIFEOS_JENKINS_IMAGE="$project"
fixture=$(mktemp)
compose() { docker compose -p "$project" -f deploy/jenkins/compose.yaml "$@"; }
cleanup() {
  result=$?
  trap - EXIT
  if [ "$result" -ne 0 ]; then
    # Diagnostics must never prevent teardown; passwords are literal strings.
    compose logs --tail 200 2>&1 | node --input-type=module -e '
      let log = "";
      for await (const chunk of process.stdin) log = (log + chunk).slice(-40000);
      process.stdout.write(log.replaceAll(process.env.JENKINS_ADMIN_PASSWORD, "[redacted]"));
    ' || true
  fi
  for owned in $(compose ps -aq 2>/dev/null); do
    docker inspect --format "owner=$project id={{.Id}} pid={{.State.Pid}} start={{.State.StartedAt}}" "$owned" || true
  done
  compose down --volumes --remove-orphans || result=1
  if docker image inspect "$project:jenkins-1" >/dev/null 2>&1; then
    docker image rm "$project:jenkins-1" >/dev/null || result=1
  fi
  rm -f "$fixture"
  remaining=$(docker ps -aq --filter "label=com.docker.compose.project=$project")
  volumes=$(docker volume ls -q --filter "label=com.docker.compose.project=$project")
  if [ -n "$remaining$volumes" ]; then echo "Owned Jenkins resources remain" >&2; result=1; fi
  echo "Cleanup verified: no containers or volumes owned by $project; port $JENKINS_PORT released with its container."
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
compose up --build --detach --wait --wait-timeout 240
cid=$(compose ps -q jenkins)
docker inspect --format "owner=$project id={{.Id}} pid={{.State.Pid}} start={{.State.StartedAt}} cleanup=docker-compose-down-volumes" "$cid"
docker port "$cid"
npm run jenkins:lint
printf 'pipeline { agent any; stages { stage("broken") { steps { echo "x" } }\n' > "$fixture"
if node tools/jenkins-lint.mjs "$fixture"; then
  echo 'Official linter accepted the deliberately invalid fixture' >&2
  exit 1
fi
node tools/jenkins-smoke.mjs
docker image inspect "$project:jenkins-1" --format '{{.Id}}' | cmp - test-results/jenkins/image-id.txt
