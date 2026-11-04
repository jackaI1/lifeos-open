#!/usr/bin/env bash
# Snapshot the LifeOS SQLite database with rotation. Run by lifeos-backup.timer (as the
# lifeos user); can also be run by hand: sudo -u lifeos /opt/lifeos/bin/backup.sh
#
#   backup.sh [--label NAME]
# Uses SQLite's online backup API, so it is consistent while the service is running
# (the database is in WAL mode). Snapshots are verified with PRAGMA integrity_check,
# gzip-compressed and checksummed. Settings come from /etc/lifeos/lifeos.env:
#   LIFEOS_DATABASE, LIFEOS_BACKUP_DIR, LIFEOS_BACKUP_KEEP
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

# Delete all but the newest KEEP files matching a glob pattern (names sort chronologically).
rotate() {
  local dir="$1" pattern="$2" keep="$3" files=() f i count
  shopt -s nullglob
  # shellcheck disable=SC2206  # the glob is intentionally expanded
  files=("$dir"/$pattern)
  shopt -u nullglob
  count="${#files[@]}"
  for ((i = 0; i < count - keep; i++)); do
    f="${files[$i]}"
    rm -f -- "$f" "$f.sha256"
    log "rotated out ${f##*/}"
  done
}

BACKUP_TMP=""
# shellcheck disable=SC2329  # invoked through the EXIT trap
cleanup() { [[ -z "$BACKUP_TMP" ]] || rm -rf "$BACKUP_TMP"; }

main() {
  local label="" db dir keep stamp name tmp
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --label)
        [[ $# -ge 2 && "$2" =~ ^[a-z0-9-]+$ ]] || die "--label needs lowercase letters, digits or dashes"
        label="$2"; shift 2 ;;
      -h | --help) sed -n '2,10p' "${BASH_SOURCE[0]}"; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  load_env
  db="${LIFEOS_DATABASE:-$LIFEOS_STATE_DIR/workspace.sqlite}"
  dir="${LIFEOS_BACKUP_DIR:-$LIFEOS_DEFAULT_BACKUP_DIR}"
  keep="${LIFEOS_BACKUP_KEEP:-14}"
  [[ "$keep" =~ ^[1-9][0-9]*$ ]] || die "LIFEOS_BACKUP_KEEP must be a positive integer"
  [[ "$db" != *"'"* && "$dir" != *"'"* ]] || die "paths containing a single quote are not supported"
  [[ -f "$db" ]] || die "database not found: $db"
  command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is not installed"

  umask 077
  mkdir -p "$dir"
  exec 9>"$dir/.lock"
  flock -n 9 || die "another backup is already running"

  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  name="lifeos-$stamp${label:+-$label}.sqlite.gz"
  tmp="$(mktemp -d "$dir/.tmp.XXXXXX")"
  BACKUP_TMP="$tmp"
  trap cleanup EXIT

  sqlite3 "$db" ".timeout 10000" ".backup '$tmp/snapshot.sqlite'"
  [[ "$(sqlite3 "$tmp/snapshot.sqlite" 'PRAGMA integrity_check;')" == "ok" ]] || die "snapshot failed the SQLite integrity check; nothing was kept"
  gzip -9 -c "$tmp/snapshot.sqlite" >"$tmp/$name"
  (cd "$tmp" && sha256sum "$name" >"$name.sha256")
  mv -f "$tmp/$name" "$dir/$name"
  mv -f "$tmp/$name.sha256" "$dir/$name.sha256"
  log "wrote $dir/$name ($(du -h "$dir/$name" | cut -f1))"

  # Scheduled snapshots and labelled ones rotate independently so a pre-update
  # snapshot is never pushed out by routine dailies.
  rotate "$dir" 'lifeos-????????T??????Z.sqlite.gz' "$keep"
  rotate "$dir" 'lifeos-????????T??????Z-?*.sqlite.gz' 5
}

main "$@"
exit 0
