#!/usr/bin/env bash
# Installs an hourly systemd timer that runs the Microsoft 365 sync (integrations/m365).
# Run once with sudo. Re-running it updates the unit files and is safe.
#
#   sudo integrations/m365/deploy/install-timer.sh --user jack --checkout /home/jack/lifeos-open \
#        --database /var/lib/lifeos/workspace.sqlite --state-dir /var/lib/lifeos-m365
set -euo pipefail

usage() {
  cat <<USAGE
Usage: sudo $0 --user NAME --checkout DIR --database FILE --state-dir DIR [--node PATH]
  --user       account that runs the sync (it must read the checkout and the database)
  --checkout   LifeOS checkout with integrations/m365 and node_modules installed
  --database   LifeOS SQLite workspace (read only)
  --state-dir  writable directory for the Microsoft token cache
  --node       Node.js 24+ binary (default: the one on PATH)
USAGE
}

user="" checkout="" database="" state_dir="" node_bin=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) user="$2"; shift 2 ;;
    --checkout) checkout="$2"; shift 2 ;;
    --database) database="$2"; shift 2 ;;
    --state-dir) state_dir="$2"; shift 2 ;;
    --node) node_bin="$2"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$user" && -n "$checkout" && -n "$database" && -n "$state_dir" ]] || { usage >&2; exit 2; }
[[ "$(id -u)" -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
[[ -f "$checkout/integrations/m365/src/timer-unit.ts" ]] || { echo "$checkout is not a LifeOS checkout" >&2; exit 1; }
node_bin="${node_bin:-$(command -v node)}"
major="$("$node_bin" -p 'process.versions.node.split(".")[0]')"
[[ "$major" -ge 24 ]] || { echo "Node.js 24 or later is required (found $major)" >&2; exit 1; }

render() {
  "$node_bin" "$checkout/integrations/m365/src/timer-unit.ts" "$@"
}
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
render --checkout "$checkout" --user "$user" --node "$node_bin" --database "$database" --state-dir "$state_dir" >"$tmp/lifeos-m365-sync.service"
render --timer >"$tmp/lifeos-m365-sync.timer"

install -d -m 0700 -o "$user" -g "$user" "$state_dir"
install -m 0644 -o root -g root "$tmp/lifeos-m365-sync.service" /etc/systemd/system/lifeos-m365-sync.service
install -m 0644 -o root -g root "$tmp/lifeos-m365-sync.timer" /etc/systemd/system/lifeos-m365-sync.timer
systemctl daemon-reload
systemctl enable --now lifeos-m365-sync.timer
echo "installed. Next run: $(systemctl list-timers lifeos-m365-sync.timer --no-legend | awk '{print $1, $2}')"
echo "logs: journalctl -u lifeos-m365-sync.service -n 50 --no-pager"
