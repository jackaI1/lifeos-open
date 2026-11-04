#!/usr/bin/env bash
# Upgrade LifeOS with a pre-update backup, an atomic switch and automatic rollback.
#
#   sudo /opt/lifeos/bin/update.sh [--pull] [--source DIR] [--rollback]
#
#   --pull        git pull --ff-only in the source checkout first
#   --source DIR  checkout to build from (default: the one recorded at install time)
#   --rollback    switch back to the previous release without building anything
#
# Steps: build the new release beside the running one -> snapshot the database ->
# switch the `current` symlink -> restart -> health check. If the new version does not
# become healthy, the previous release is restored and restarted. The running version
# is never modified, so a failed build changes nothing.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

prune_releases() {
  local current="$1" previous="$2" releases=() r kept=0
  while IFS= read -r r; do releases+=("$r"); done < <(ls -1t "$LIFEOS_PREFIX/releases")
  for r in "${releases[@]}"; do
    if [[ "$r" == "$current" || "$r" == "$previous" || "$kept" -lt "$LIFEOS_KEEP_RELEASES" ]]; then
      kept=$((kept + 1))
      continue
    fi
    rm -rf "${LIFEOS_PREFIX:?}/releases/$r"
    log "removed old release $r"
  done
}

switch_to() {
  activate_release "$1"
  service_restart
  wait_healthy "${LIFEOS_HEALTH_TIMEOUT:-60}"
}

main() {
  local pull=false rollback=false source_dir="" old new owner
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pull) pull=true; shift ;;
      --rollback) rollback=true; shift ;;
      --source) [[ $# -ge 2 ]] || die "--source needs a directory"; source_dir="$2"; shift 2 ;;
      -h | --help) sed -n '2,13p' "${BASH_SOURCE[0]}"; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done
  require_root
  [[ -d "$LIFEOS_PREFIX/releases" ]] || die "LifeOS is not installed; run install.sh first"
  exec 8>/run/lifeos-update.lock
  flock -n 8 || die "another update is already running"
  old="$(current_release)"

  if "$rollback"; then
    local prev=""
    [[ -f "$LIFEOS_PREFIX/previous" ]] && prev="$(cat "$LIFEOS_PREFIX/previous")"
    [[ -n "$prev" && -d "$LIFEOS_PREFIX/releases/$prev" ]] || die "no previous release to roll back to"
    log "rolling back $old -> $prev"
    switch_to "$prev" || die "previous release $prev is not healthy either; see: journalctl -u lifeos -e"
    printf '%s\n' "$old" >"$LIFEOS_PREFIX/previous"
    log "rolled back to $prev (database is unchanged; see docs/self-host-linux.md to restore a snapshot)"
    return 0
  fi

  if [[ -z "$source_dir" && -r "$LIFEOS_CONF_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$LIFEOS_CONF_FILE"
    source_dir="${LIFEOS_SOURCE:-}"
  fi
  [[ -n "$source_dir" && -f "$source_dir/package.json" ]] || die "source checkout not found; pass --source DIR"
  source_dir="$(cd "$source_dir" && pwd)"

  if "$pull"; then
    owner="$(stat -c %U "$source_dir")"
    log "git pull in $source_dir as $owner"
    runuser -u "$owner" -- git -C "$source_dir" pull --ff-only
  fi

  new="$(source_fingerprint "$source_dir")"
  if [[ "$new" == "$old" ]]; then
    log "already up to date (release $old)"
    return 0
  fi
  log "updating $old -> $new"
  build_release "$source_dir" "$new"

  if [[ -f "$(env_value LIFEOS_DATABASE)" ]]; then
    runuser -u "$LIFEOS_USER" -- "$LIFEOS_PREFIX/bin/backup.sh" --label pre-update
  fi

  if switch_to "$new"; then
    printf '%s\n' "$old" >"$LIFEOS_PREFIX/previous"
    install_support_files "$LIFEOS_PREFIX/releases/$new"
    prune_releases "$new" "$old"
    log "update complete: release $new is healthy (previous: $old)"
  else
    warn "release $new did not become healthy; restoring $old"
    journalctl -u lifeos.service -n 20 --no-pager >&2 2>/dev/null || true
    if [[ -n "$old" ]] && switch_to "$old"; then
      rm -rf "${LIFEOS_PREFIX:?}/releases/$new"
      die "update failed and was rolled back to $old; a pre-update database snapshot is in $(env_value LIFEOS_BACKUP_DIR)"
    fi
    die "update failed and the previous release is not healthy either; see: journalctl -u lifeos -e"
  fi
}

main "$@"
exit 0
