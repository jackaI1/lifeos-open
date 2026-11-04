#!/usr/bin/env bash
# Install LifeOS Open as a systemd service on Debian/Ubuntu or Fedora/RHEL-family Linux.
# Idempotent: safe to re-run. Existing configuration, data and backups are never overwritten.
#
#   sudo ./deploy/linux/install.sh [--demo] [--source DIR]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

usage() {
  cat <<USAGE
Usage: sudo $0 [--demo] [--source DIR]
  --demo        seed the fictional demo workspace on first start (default: empty workspace)
  --source DIR  LifeOS checkout to install (default: the checkout containing this script)
Environment: LIFEOS_NODE_VERSION pins a Node.js ${LIFEOS_NODE_MAJOR}.x release (default: latest ${LIFEOS_NODE_MAJOR}.x).
USAGE
}

install_packages() {
  local missing=() cmd
  for cmd in curl tar xz sha256sum sqlite3 flock runuser; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  [[ "${#missing[@]}" -gt 0 ]] || return 0
  log "installing system packages for: ${missing[*]}"
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends ca-certificates curl tar xz-utils coreutils sqlite3 util-linux
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q ca-certificates curl tar xz coreutils sqlite util-linux
  else
    die "unsupported package manager; install curl, tar, xz, sha256sum, sqlite3 and util-linux, then re-run"
  fi
}

install_node() {
  local have="" arch version tarball base tmp
  if [[ -x "$LIFEOS_PREFIX/node/bin/node" ]]; then
    have="$("$LIFEOS_PREFIX/node/bin/node" --version)"
    if [[ "${have#v}" == "${LIFEOS_NODE_VERSION:-${have#v}}" && "${have#v}" == "$LIFEOS_NODE_MAJOR".* ]]; then
      log "Node.js $have already installed"
      return 0
    fi
  fi
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) die "unsupported CPU architecture: $(uname -m)" ;;
  esac
  base="https://nodejs.org/dist/latest-v${LIFEOS_NODE_MAJOR}.x"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  curl -fsSL --retry 3 -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt"
  version="${LIFEOS_NODE_VERSION:-}"
  if [[ -z "$version" ]]; then
    version="$(grep -oE "node-v${LIFEOS_NODE_MAJOR}\\.[0-9]+\\.[0-9]+-linux-${arch}\\.tar\\.xz" "$tmp/SHASUMS256.txt" | head -n 1 | sed -E 's/^node-v([0-9.]+)-.*/\1/')"
  fi
  [[ -n "$version" ]] || die "could not determine the latest Node.js ${LIFEOS_NODE_MAJOR}.x version"
  tarball="node-v${version}-linux-${arch}.tar.xz"
  log "downloading Node.js v${version} (${arch}) and verifying its SHA-256"
  curl -fsSL --retry 3 -o "$tmp/$tarball" "https://nodejs.org/dist/v${version}/$tarball"
  curl -fsSL --retry 3 -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v${version}/SHASUMS256.txt"
  (cd "$tmp" && grep -F " $tarball" SHASUMS256.txt | sha256sum -c --status -) || die "Node.js checksum verification failed"
  mkdir -p "$LIFEOS_PREFIX"
  rm -rf "$LIFEOS_PREFIX/node.new"
  mkdir "$LIFEOS_PREFIX/node.new"
  tar -xJf "$tmp/$tarball" -C "$LIFEOS_PREFIX/node.new" --strip-components=1
  rm -rf "$LIFEOS_PREFIX/node"
  mv "$LIFEOS_PREFIX/node.new" "$LIFEOS_PREFIX/node"
  log "installed Node.js $("$LIFEOS_PREFIX/node/bin/node" --version) to $LIFEOS_PREFIX/node"
}

create_user() {
  if id -u "$LIFEOS_USER" >/dev/null 2>&1; then
    log "service user '$LIFEOS_USER' exists"
    return 0
  fi
  useradd --system --user-group --home-dir "$LIFEOS_STATE_DIR" --no-create-home --shell /usr/sbin/nologin "$LIFEOS_USER"
  log "created system user '$LIFEOS_USER'"
}

create_dirs() {
  install -d -m 0755 -o root -g root "$LIFEOS_PREFIX" "$LIFEOS_PREFIX/releases"
  install -d -m 0700 -o "$LIFEOS_USER" -g "$LIFEOS_USER" "$LIFEOS_STATE_DIR" "$LIFEOS_DEFAULT_BACKUP_DIR"
  install -d -m 0750 -o root -g "$LIFEOS_USER" "$(dirname "$LIFEOS_ENV_FILE")"
}

write_env_file() {
  local demo="$1" token
  if [[ -f "$LIFEOS_ENV_FILE" ]]; then
    log "keeping existing $LIFEOS_ENV_FILE"
    return 0
  fi
  token="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  (
    umask 077
    cat >"$LIFEOS_ENV_FILE" <<ENV
# LifeOS environment, read by systemd (KEY=value, no quotes or export).
# Edit, then: sudo systemctl restart lifeos
PORT=8787
APP_ORIGIN=http://127.0.0.1:8787
# local = sign in with LOCAL_ACCESS_TOKEN; demo = no sign-in (loopback only, fictional data)
AUTH_MODE=local
LOCAL_ACCESS_TOKEN=${token}
DEMO_SEED=${demo}
LIFEOS_DATABASE=${LIFEOS_STATE_DIR}/workspace.sqlite
LLM_MODE=mock
GOOGLE_MODE=local
# Backups (see lifeos-backup.timer): destination and how many daily snapshots to keep.
LIFEOS_BACKUP_DIR=${LIFEOS_DEFAULT_BACKUP_DIR}
LIFEOS_BACKUP_KEEP=14
ENV
  )
  chown "root:$LIFEOS_USER" "$LIFEOS_ENV_FILE"
  chmod 0640 "$LIFEOS_ENV_FILE"
  log "wrote $LIFEOS_ENV_FILE (generated access token; read it with: sudo grep LOCAL_ACCESS_TOKEN $LIFEOS_ENV_FILE)"
}

main() {
  local demo=false source_dir="" id
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --demo) demo=true; shift ;;
      --source) [[ $# -ge 2 ]] || die "--source needs a directory"; source_dir="$2"; shift 2 ;;
      -h | --help) usage; exit 0 ;;
      *) usage >&2; die "unknown argument: $1" ;;
    esac
  done
  [[ "$(uname -s)" == "Linux" ]] || die "this installer supports Linux only"
  require_root
  source_dir="$(cd "${source_dir:-$SCRIPT_DIR/../..}" && pwd)"
  [[ -f "$source_dir/package.json" ]] || die "$source_dir does not look like a LifeOS checkout"

  install_packages
  install_node
  create_user
  create_dirs
  write_env_file "$demo"

  id="$(source_fingerprint "$source_dir")"
  build_release "$source_dir" "$id"
  activate_release "$id"
  install_support_files "$LIFEOS_PREFIX/releases/$id"
  printf 'LIFEOS_SOURCE=%q\n' "$source_dir" >"$LIFEOS_CONF_FILE"
  chmod 0644 "$LIFEOS_CONF_FILE"

  if have_systemd; then
    systemctl enable lifeos.service lifeos-backup.timer >/dev/null 2>&1
    systemctl restart lifeos.service
    systemctl start lifeos-backup.timer
    if wait_healthy 60; then
      log "LifeOS is running: $(env_value APP_ORIGIN)"
    else
      journalctl -u lifeos.service -n 30 --no-pager >&2 || true
      die "service did not become healthy; see: journalctl -u lifeos -e"
    fi
  else
    warn "systemd is not running; units were installed but not started"
  fi
  log "release $id active. Config: $LIFEOS_ENV_FILE  Data: $LIFEOS_STATE_DIR  Backups: $(env_value LIFEOS_BACKUP_DIR)"
  log "Upgrade with: sudo $LIFEOS_PREFIX/bin/update.sh --pull"
}

main "$@"
exit 0
