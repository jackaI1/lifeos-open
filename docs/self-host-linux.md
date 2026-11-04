# Self-hosting LifeOS on Linux

`deploy/linux/` installs the standalone LifeOS service as a hardened systemd unit
with scheduled SQLite backups, safe upgrades and a clean uninstall. Everything is
plain Bash (`set -euo pipefail`, checked with ShellCheck in CI) and the whole
lifecycle is exercised in an Ubuntu container with real systemd on every change.

Supported: Debian/Ubuntu (apt) and Fedora/RHEL-family (dnf) on x86-64 or arm64, with systemd.
LifeOS needs Node.js 24; the installer downloads the official tarball, verifies its
SHA-256 and keeps it private under `/opt/lifeos/node`, so your system Node is untouched.

## Install

```sh
git clone https://github.com/jackaI1/lifeos-open.git
cd lifeos-open
sudo ./deploy/linux/install.sh          # add --demo to seed the fictional demo workspace
```

The installer is idempotent: re-running it changes nothing that is already in place and
never overwrites your configuration, token, database or backups. It:

1. installs `curl`, `tar`, `xz`, `sqlite3` and `util-linux` if missing;
2. installs a checksum-verified Node.js 24 to `/opt/lifeos/node`;
3. creates the `lifeos` system user (no shell, no login);
4. builds the app as that unprivileged user into `/opt/lifeos/releases/<id>`, then makes it root-owned;
5. writes `/etc/lifeos/lifeos.env` (mode 0640) with a random access token;
6. installs and starts `lifeos.service` and enables `lifeos-backup.timer`;
7. waits until `/api/health` answers `online`, or prints the journal and fails.

Read your access token, then open the app:

```sh
sudo grep LOCAL_ACCESS_TOKEN /etc/lifeos/lifeos.env
xdg-open http://127.0.0.1:8787
```

The service listens on loopback only (the app refuses non-loopback origins). To use it from
another machine, tunnel instead of exposing it: `ssh -L 8787:127.0.0.1:8787 you@server`.

## Layout

| Path | Contents |
| --- | --- |
| `/opt/lifeos/current` | symlink to the active release (`releases/<12-char source hash>`) |
| `/opt/lifeos/releases/` | the three newest releases (root-owned, not writable by the service) |
| `/opt/lifeos/node/` | private Node.js 24 |
| `/opt/lifeos/bin/` | installed `update.sh`, `backup.sh`, `uninstall.sh`, `common.sh` |
| `/etc/lifeos/lifeos.env` | configuration read by systemd (`KEY=value`, no quotes) |
| `/var/lib/lifeos/workspace.sqlite` | your data (the only path the service can write) |
| `/var/backups/lifeos/` | compressed, checksummed snapshots |

`lifeos.service` restarts on failure (3 s delay, at most 5 starts per 5 minutes) and runs
with `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`,
`PrivateDevices` and a single writable directory. Edit `/etc/lifeos/lifeos.env` and run
`sudo systemctl restart lifeos` to change settings; see the configuration table in the
[local reference](local-workspace.md#configuration) for the available variables.

```sh
systemctl status lifeos            # state
journalctl -u lifeos -f            # logs
systemctl list-timers lifeos-backup.timer
```

## Backups

`lifeos-backup.timer` runs `backup.sh` daily at about 03:30 (randomised by up to 15 minutes, and
run at next boot if the machine was off). Each run:

- takes a consistent copy with SQLite's online backup API while LifeOS keeps running;
- refuses to keep the copy unless `PRAGMA integrity_check` returns `ok`;
- writes `lifeos-<UTC time>.sqlite.gz` and a `.sha256` file atomically;
- keeps the newest `LIFEOS_BACKUP_KEEP` (default 14) scheduled snapshots and, separately,
  the newest 5 `-pre-update` snapshots.

Run one by hand with `sudo systemctl start lifeos-backup.service`. Snapshots are plain
SQLite files, so they also work with the `sqlite3` CLI. To restore:

```sh
cd /var/backups/lifeos && sudo sha256sum -c lifeos-20260101T033000Z.sqlite.gz.sha256
sudo systemctl stop lifeos
sudo rm -f /var/lib/lifeos/workspace.sqlite-wal /var/lib/lifeos/workspace.sqlite-shm
gunzip -c lifeos-20260101T033000Z.sqlite.gz | sudo -u lifeos tee /var/lib/lifeos/workspace.sqlite >/dev/null
sudo systemctl start lifeos
```

(The in-app Settings backup is a separate JSON export; both can coexist.) If you change
`LIFEOS_BACKUP_DIR`, also add it to `ReadWritePaths=` in `lifeos-backup.service`
(`sudo systemctl edit lifeos-backup.service`).

## Upgrade

```sh
sudo /opt/lifeos/bin/update.sh --pull
```

`--pull` runs `git pull --ff-only` in the checkout you installed from (as its owner). Then:

1. if the source is unchanged the script says so and stops;
2. the new version is built **beside** the running one, so a failed build changes nothing;
3. a `-pre-update` database snapshot is taken;
4. the `current` symlink is switched atomically and the service restarted;
5. the update only succeeds once `/api/health` reports `online`; otherwise the previous
   release is switched back and restarted automatically, and the script exits non-zero.

`sudo /opt/lifeos/bin/update.sh --rollback` returns to the previous release by hand. Rolling
back restores the code only; if a new version changed the database in a way you want to
undo, restore the pre-update snapshot as above.

## Uninstall

```sh
sudo /opt/lifeos/bin/uninstall.sh            # removes the service and /opt/lifeos; keeps data, config, backups
sudo /opt/lifeos/bin/uninstall.sh --purge    # also deletes data, config, backups and the lifeos user
```

Both ask for confirmation (`--purge` requires typing `delete my data`); pass `--yes` to skip it in scripts.

## How it is tested

`.github/workflows/linux-deploy.yml` runs on every change to this directory or the app:

- **ShellCheck** over every script (`shellcheck --external-sources --source-path=SCRIPTDIR --shell=bash`).
- **Install + service check** in an Ubuntu 22.04 and 24.04 container with systemd as PID 1.
  [`deploy/linux/test/e2e.sh`](../deploy/linux/test/e2e.sh) asserts that the service is active and
  answers an authenticated `/api/health`, that anonymous requests are refused, that it runs as
  `lifeos` and cannot write its own code, that re-running the installer changes nothing, that backups
  verify and rotate, that the service restarts after `kill -9`, that an update switches releases, that a
  deliberately broken release rolls back automatically, and that uninstall keeps data while `--purge`
  removes it.

To run it yourself on a throwaway Ubuntu VM or container: `sudo bash deploy/linux/test/e2e.sh "$PWD"`.
It installs and then purges LifeOS, so do not run it on a machine whose LifeOS data you want to keep.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Installer ends with "service did not become healthy" | the journal tail it prints; `journalctl -u lifeos -e` |
| Port 8787 busy | change `PORT` and `APP_ORIGIN` in `lifeos.env` (ports 1024–65535), restart |
| `401` on every request | expected in `AUTH_MODE=local`; sign in with `LOCAL_ACCESS_TOKEN` |
| Update says "source checkout not found" | pass `--source /path/to/lifeos-open` |
