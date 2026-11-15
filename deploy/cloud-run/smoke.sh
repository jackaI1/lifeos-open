#!/usr/bin/env bash
# Build the public-demo image exactly as Cloud Run will run it, start it, and check the health route.
# Everything started here is stopped and removed on exit, and the script checks that it is gone.
set -euo pipefail

IMAGE="${SMOKE_IMAGE:-lifeos-demo:smoke}"
NAME="lifeos-demo-smoke-$$"
PORT="${SMOKE_PORT:-18080}"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then echo "cleanup failed: $NAME still exists" >&2; exit 1; fi
}
trap cleanup EXIT

docker build --target public-demo -t "$IMAGE" .
docker run -d --name "$NAME" -e PORT=8080 -p "127.0.0.1:$PORT:8080" "$IMAGE" >/dev/null

health=""
for _ in $(seq 1 60); do
  health="$(curl -fsS "http://127.0.0.1:$PORT/healthz" 2>/dev/null || true)"
  [ -n "$health" ] && break
  sleep 2
done
echo "healthz: $health"
case "$health" in *'"status":"ok"'*) ;; *) docker logs "$NAME" | tail -n 40; exit 1 ;; esac

# The public host serves the app shell and must not expose the API.
curl -fsS "http://127.0.0.1:$PORT/" | grep -qi '<html'
api_status="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health")"
echo "api status on the public host: $api_status"
[ "$api_status" != 200 ]
echo "smoke test passed"
