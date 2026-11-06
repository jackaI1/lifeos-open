#!/usr/bin/env bash
# Shared helpers for the LifeOS Linux deployment scripts. Source it; do not run it.
# shellcheck disable=SC2034  # variables are consumed by the scripts that source this file

LIFEOS_PREFIX=/opt/lifeos
LIFEOS_USER=lifeos
LIFEOS_ENV_FILE=/etc/lifeos/lifeos.env
LIFEOS_CONF_FILE=/etc/lifeos/install.conf
LIFEOS_STATE_DIR=/var/lib/lifeos
LIFEOS_DEFAULT_BACKUP_DIR=/var/backups/lifeos
LIFEOS_NODE_MAJOR=24
LIFEOS_KEEP_RELEASES=3
# Paths copied from the source checkout into each release (everything the app needs).
LIFEOS_RELEASE_PATHS=(package.json package-lock.json src public demo tools/build.mjs tools/build-demo-feed.ts deploy/linux)

log() { printf '[lifeos] %s\n' "$*"; }
warn() { printf '[lifeos] WARNING: %s\n' "$*" >&2; }
die() { printf '[lifeos] ERROR: %s\n' "$*" >&2; exit 1; }

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "run as root (for example: sudo $0)"
}

have_systemd() { [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; }

# Read KEY=VALUE lines from a systemd-style environment file without executing it.
load_env() {
  local file="${1:-$LIFEOS_ENV_FILE}" line key value
  [[ -r "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    export "$key=$value"
  done <"$file"
}

# Read one key from the env file (empty output when absent).
env_value() {
  local key="$1" line
  [[ -r "$LIFEOS_ENV_FILE" ]] || return 0
  line="$(grep -E "^${key}=" "$LIFEOS_ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  printf '%s' "$line"
}

# Content fingerprint of the files that make up a release. Identical source => identical id.
source_fingerprint() {
  local src="$1" p
  (
    cd "$src" || exit 1
    for p in "${LIFEOS_RELEASE_PATHS[@]}"; do
      if [[ -e "$p" ]]; then find "$p" -type f -print0; fi
    done | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12
  )
}

# Locate a Node >= 24 binary dir; prints the bin directory.
node_bin_dir() {
  local dir="$LIFEOS_PREFIX/node/bin"
  [[ -x "$dir/node" ]] || return 1
  printf '%s' "$dir"
}

# Build a release from SOURCE into $LIFEOS_PREFIX/releases/ID. Prints nothing; dies on failure.
# The build runs as the unprivileged service user; the finished tree is root-owned and read-only to it.
build_release() {
  local src="$1" id="$2" dest="$LIFEOS_PREFIX/releases/$2" tmp node_dir
  node_dir="$(node_bin_dir)" || die "Node.js is not installed under $LIFEOS_PREFIX/node"
  if [[ -f "$dest/.complete" ]]; then
    log "release $id already built"
    return 0
  fi
  rm -rf "$dest"
  mkdir -p "$dest"
  local p
  for p in "${LIFEOS_RELEASE_PATHS[@]}"; do
    [[ -e "$src/$p" ]] || die "source is missing $p; is $src a LifeOS checkout?"
    mkdir -p "$dest/$(dirname "$p")"
    cp -a "$src/$p" "$dest/$(dirname "$p")/"
  done
  tmp="$(mktemp -d "$dest/.build.XXXXXX")"
  chown -R "$LIFEOS_USER:$LIFEOS_USER" "$dest"
  log "installing dependencies and building release $id (this takes a minute)"
  # shellcheck disable=SC2016  # $1/$2 expand inside the child shell, by design
  if ! runuser -u "$LIFEOS_USER" -- env "PATH=$node_dir:/usr/bin:/bin" "HOME=$tmp" \
      sh -c 'cd "$1" && npm ci --ignore-scripts --no-audit --no-fund --cache "$2/npm-cache" && npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund' \
      lifeos-build "$dest" "$tmp"; then
    rm -rf "$dest"
    die "build of release $id failed; the running version was not changed"
  fi
  rm -rf "$tmp"
  [[ -f "$dest/build/server.mjs" ]] || { rm -rf "$dest"; die "build produced no build/server.mjs"; }
  chown -R root:root "$dest"
  chmod -R go-w "$dest"
  touch "$dest/.complete"
}

# Atomically point $LIFEOS_PREFIX/current at a release id.
activate_release() {
  local id="$1"
  [[ -d "$LIFEOS_PREFIX/releases/$id" ]] || die "no such release: $id"
  ln -sfn "releases/$id" "$LIFEOS_PREFIX/current.new"
  mv -Tf "$LIFEOS_PREFIX/current.new" "$LIFEOS_PREFIX/current"
}

current_release() {
  local target
  target="$(readlink "$LIFEOS_PREFIX/current" 2>/dev/null || true)"
  printf '%s' "${target##*/}"
}

# Copy scripts and systemd units from a release into place. Returns 0 always; sets UNITS_CHANGED=1 on unit changes.
install_support_files() {
  local from="$1/deploy/linux" f
  UNITS_CHANGED=0
  mkdir -p "$LIFEOS_PREFIX/bin"
  for f in common.sh install.sh update.sh backup.sh uninstall.sh; do
    install -m 0755 -o root -g root "$from/$f" "$LIFEOS_PREFIX/bin/$f.new"
    mv -f "$LIFEOS_PREFIX/bin/$f.new" "$LIFEOS_PREFIX/bin/$f"
  done
  if have_systemd; then
    for f in lifeos.service lifeos-backup.service lifeos-backup.timer; do
      if ! cmp -s "$from/systemd/$f" "/etc/systemd/system/$f"; then
        install -m 0644 -o root -g root "$from/systemd/$f" "/etc/systemd/system/$f"
        UNITS_CHANGED=1
      fi
    done
    [[ "$UNITS_CHANGED" -eq 0 ]] || systemctl daemon-reload
  fi
}

# Authenticated (when AUTH_MODE=local) health probe. Succeeds only on HTTP 200 and status "online".
health_check_once() {
  local origin mode token jar body code
  origin="$(env_value APP_ORIGIN)"; origin="${origin:-http://127.0.0.1:$(env_value PORT)}"
  [[ "$origin" != "http://127.0.0.1:" ]] || origin="http://127.0.0.1:8787"
  mode="$(env_value AUTH_MODE)"; mode="${mode:-demo}"
  jar="$(mktemp)"
  if [[ "$mode" == "local" ]]; then
    token="$(env_value LOCAL_ACCESS_TOKEN)"
    printf 'token=%s' "$token" | curl -s -o /dev/null --max-time 5 -c "$jar" -H "Origin: $origin" -d @- "$origin/auth/local" || true
  fi
  body="$(curl -s --max-time 5 -b "$jar" -w '\n%{http_code}' "$origin/api/health" || true)"
  rm -f "$jar"
  code="${body##*$'\n'}"
  [[ "$code" == "200" && "$body" == *'"status":"online"'* ]]
}

# Wait up to $1 seconds (default 60) for the service to become healthy.
wait_healthy() {
  local timeout="${1:-60}" i
  for ((i = 0; i < timeout; i++)); do
    if health_check_once; then return 0; fi
    sleep 1
  done
  return 1
}

service_restart() {
  if have_systemd; then systemctl reset-failed lifeos.service 2>/dev/null || true; systemctl restart lifeos.service; else warn "systemd not available; start the service manually"; fi
}
