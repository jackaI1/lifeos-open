#!/usr/bin/env bash
# End-to-end test of the Linux deployment. Run as root inside a disposable Ubuntu
# container with systemd (see test/Dockerfile.systemd and .github/workflows/linux-deploy.yml):
#   bash deploy/linux/test/e2e.sh /path/to/lifeos-open-checkout
# It installs, checks the service responds, re-runs the installer, snapshots, kills the
# service, upgrades, forces a failed upgrade, rolls back, uninstalls and purges.
set -euo pipefail

SRC="$(cd "${1:?usage: e2e.sh CHECKOUT}" && pwd)"
STEP=0
pass() { STEP=$((STEP + 1)); printf 'ok %d - %s\n' "$STEP" "$*"; }
fail() { printf 'not ok - %s\n' "$*" >&2; journalctl -u lifeos -n 40 --no-pager >&2 || true; exit 1; }
check() { local msg="$1"; shift; if "$@"; then pass "$msg"; else fail "$msg"; fi; }

copy_source() { # copy_source DEST: working copy without VCS/build output
  mkdir -p "$1"
  tar -C "$SRC" --exclude=./.git --exclude=./node_modules --exclude=./build -cf - . | tar -C "$1" -xf -
}
count_backups() { find /var/backups/lifeos -maxdepth 1 -name "$1" | wc -l; }

# --- install -------------------------------------------------------------------
bash "$SRC/deploy/linux/install.sh" --source "$SRC"
# shellcheck source=/dev/null
source /opt/lifeos/bin/common.sh

check "service is active" systemctl is-active --quiet lifeos.service
check "service is enabled" systemctl is-enabled --quiet lifeos.service
check "backup timer is active" systemctl is-active --quiet lifeos-backup.timer
check "health endpoint answers 200 after login" health_check_once
check "unauthenticated request is refused" test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/bootstrap)" = 401
check "runs as the lifeos user" test "$(stat -c %U "/proc/$(systemctl show -p MainPID --value lifeos.service)")" = lifeos
check "env file is 0640 root:lifeos" test "$(stat -c '%a %U:%G' /etc/lifeos/lifeos.env)" = "640 root:lifeos"
check "database lives in the state directory" test -f /var/lib/lifeos/workspace.sqlite
check "app code is not writable by the service user" bash -c '! runuser -u lifeos -- touch /opt/lifeos/current/probe 2>/dev/null'
token_before="$(env_value LOCAL_ACCESS_TOKEN)"
release_before="$(current_release)"

# --- idempotent re-run ---------------------------------------------------------
bash "$SRC/deploy/linux/install.sh" --source "$SRC"
check "re-running install keeps the access token" test "$(env_value LOCAL_ACCESS_TOKEN)" = "$token_before"
check "re-running install keeps the same release" test "$(current_release)" = "$release_before"
check "re-running install leaves one lifeos user" test "$(getent passwd lifeos | wc -l)" = 1
check "healthy after re-run" health_check_once

# --- backups -------------------------------------------------------------------
systemctl start lifeos-backup.service
check "timer-run backup wrote a snapshot" test "$(count_backups 'lifeos-*Z.sqlite.gz')" -ge 1
snapshot="$(find /var/backups/lifeos -maxdepth 1 -name 'lifeos-*Z.sqlite.gz' | sort | tail -n 1)"
check "snapshot checksum verifies" bash -c "cd /var/backups/lifeos && sha256sum -c --status '$(basename "$snapshot").sha256'"
check "snapshot is a valid SQLite database" bash -c "gunzip -c '$snapshot' > /tmp/restore-check.sqlite && test \"\$(sqlite3 /tmp/restore-check.sqlite 'PRAGMA integrity_check;')\" = ok"
for _ in 1 2 3 4; do sleep 1; runuser -u lifeos -- env LIFEOS_BACKUP_KEEP=2 /opt/lifeos/bin/backup.sh >/dev/null; done
check "rotation keeps only the newest 2 snapshots" test "$(count_backups 'lifeos-*Z.sqlite.gz')" = 2

# --- restart policy ------------------------------------------------------------
pid="$(systemctl show -p MainPID --value lifeos.service)"
kill -9 "$pid"
check "service restarts after being killed" wait_healthy 30
check "restart produced a new process" test "$(systemctl show -p MainPID --value lifeos.service)" != "$pid"

# --- update --------------------------------------------------------------------
noop_output="$(/opt/lifeos/bin/update.sh --source "$SRC" 2>&1)"
check "update with unchanged source is a no-op" test "${noop_output#*already up to date}" != "$noop_output"
copy_source /tmp/src-v2
echo '<!-- v2 -->' >>/tmp/src-v2/public/index.html
/opt/lifeos/bin/update.sh --source /tmp/src-v2
release_v2="$(current_release)"
check "update switched to a new release" test "$release_v2" != "$release_before"
check "update recorded the previous release" test "$(cat /opt/lifeos/previous)" = "$release_before"
check "update took a pre-update snapshot" test "$(count_backups 'lifeos-*-pre-update.sqlite.gz')" -ge 1
check "healthy after update" health_check_once

# --- failed update rolls back automatically ------------------------------------
copy_source /tmp/src-bad
sed -i '1i throw new Error("deliberately broken release");' /tmp/src-bad/src/local/main.ts
if LIFEOS_HEALTH_TIMEOUT=10 /opt/lifeos/bin/update.sh --source /tmp/src-bad; then fail "broken update should have failed"; fi
check "failed update left the working release active" test "$(current_release)" = "$release_v2"
check "healthy after automatic rollback" wait_healthy 30
check "broken release was discarded" test "$(find /opt/lifeos/releases -mindepth 1 -maxdepth 1 | wc -l)" = 2

# --- manual rollback -----------------------------------------------------------
/opt/lifeos/bin/update.sh --rollback
check "manual rollback restored the first release" test "$(current_release)" = "$release_before"
check "healthy after manual rollback" health_check_once

# --- uninstall keeps data, purge removes it ------------------------------------
/opt/lifeos/bin/uninstall.sh --yes
check "uninstall removed the units" test ! -e /etc/systemd/system/lifeos.service
check "uninstall removed the app" test ! -e /opt/lifeos
check "uninstall kept the database" test -f /var/lib/lifeos/workspace.sqlite
check "uninstall kept the configuration" test -f /etc/lifeos/lifeos.env
check "uninstall kept the backups" test "$(count_backups 'lifeos-*')" -ge 1

bash "$SRC/deploy/linux/install.sh" --source "$SRC"
check "reinstall reuses the kept configuration" test "$(grep -c '^LOCAL_ACCESS_TOKEN=' /etc/lifeos/lifeos.env)" = 1
check "healthy after reinstall" health_check_once
/opt/lifeos/bin/uninstall.sh --purge --yes
check "purge removed the data" test ! -e /var/lib/lifeos
check "purge removed the configuration" test ! -e /etc/lifeos
check "purge removed the backups" test ! -e /var/backups/lifeos
check "purge removed the service user" bash -c '! id lifeos >/dev/null 2>&1'
echo "All $STEP checks passed."
