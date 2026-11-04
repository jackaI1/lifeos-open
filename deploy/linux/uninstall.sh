#!/usr/bin/env bash
# Remove the LifeOS service. By default your data, configuration and backups are KEPT.
#
#   sudo /opt/lifeos/bin/uninstall.sh [--purge] [--yes]
#
#   --purge  also delete the database, /etc/lifeos, all backups and the 'lifeos' user
#   --yes    do not ask for confirmation (required when not run from a terminal)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

main() {
  local purge=false yes=false answer backup_dir
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --purge) purge=true; shift ;;
      --yes) yes=true; shift ;;
      -h | --help) sed -n '2,8p' "${BASH_SOURCE[0]}"; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done
  require_root
  backup_dir="$(env_value LIFEOS_BACKUP_DIR)"; backup_dir="${backup_dir:-$LIFEOS_DEFAULT_BACKUP_DIR}"

  if ! "$yes"; then
    [[ -t 0 ]] || die "not a terminal; re-run with --yes to confirm"
    if "$purge"; then
      printf 'This permanently deletes %s, %s, %s and the %s user.\nType "delete my data" to continue: ' \
        "$LIFEOS_STATE_DIR" "$backup_dir" "$(dirname "$LIFEOS_ENV_FILE")" "$LIFEOS_USER"
      read -r answer
      [[ "$answer" == "delete my data" ]] || die "aborted"
    else
      printf 'Remove the LifeOS service and %s? Data and backups are kept. [y/N] ' "$LIFEOS_PREFIX"
      read -r answer
      [[ "$answer" == "y" || "$answer" == "Y" ]] || die "aborted"
    fi
  fi

  if have_systemd; then
    systemctl disable --now lifeos-backup.timer lifeos.service >/dev/null 2>&1 || true
    systemctl stop lifeos-backup.service >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/lifeos.service /etc/systemd/system/lifeos-backup.service /etc/systemd/system/lifeos-backup.timer
    systemctl daemon-reload
    systemctl reset-failed lifeos.service lifeos-backup.service >/dev/null 2>&1 || true
  fi
  rm -rf "${LIFEOS_PREFIX:?}"
  rm -f "$LIFEOS_CONF_FILE" /run/lifeos-update.lock
  log "removed the service, units and $LIFEOS_PREFIX"

  if "$purge"; then
    rm -rf "${LIFEOS_STATE_DIR:?}" "${backup_dir:?}" "$(dirname "$LIFEOS_ENV_FILE")"
    if id -u "$LIFEOS_USER" >/dev/null 2>&1; then userdel "$LIFEOS_USER" 2>/dev/null || true; fi
    log "purged data, configuration, backups and the $LIFEOS_USER user"
  else
    log "kept data in $LIFEOS_STATE_DIR, config in $(dirname "$LIFEOS_ENV_FILE") and backups in $backup_dir (use --purge to delete)"
  fi
}

main "$@"
exit 0
