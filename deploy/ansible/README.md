# Ansible role for LifeOS

I wrote an Ansible role because installing LifeOS on my Linux server by hand was
easy to get wrong, and I wanted to run the same steps again after every update without
breaking the data already on the machine.

## What it does

Ansible is a tool that runs the same set of steps on a server from a file you keep in
version control. This role does the job of the Bash installer in
[`deploy/linux`](../linux) and nothing more:

1. installs the system packages LifeOS needs (`git`, `sqlite3`, `curl` and a few others);
2. creates a `lifeos` service user with no login shell;
3. downloads Node.js 24 from nodejs.org and checks it against the official SHA-256 list;
4. clones the LifeOS source at the version you choose and builds one release per commit;
5. points `/opt/lifeos/current` at that release and installs the systemd unit from it;
6. writes `/etc/lifeos/lifeos.env`, keeping the access token from the last run;
7. starts the service, waits until it answers, and signs in to check its health.

Running it again changes nothing unless an input changed: a new commit, a new Node.js
version, a different unit file or a changed setting. Your workspace in
`/var/lib/lifeos` is never touched by the role.

## Try it

```
cp inventory/hosts.example.yml inventory/hosts.yml   # then put your server in it
ansible-playbook playbook.yml                          # install or update
```

Set `lifeos_version` to a commit or tag to pin the code. Set `lifeos_demo_seed: true` to
start with the fictional demo workspace. The access token is in the environment file, so
read it with `sudo grep LOCAL_ACCESS_TOKEN /etc/lifeos/lifeos.env`.

## Files

| Path | Purpose |
| --- | --- |
| `playbook.yml` | Runs the `lifeos` role on the hosts in the inventory |
| `inventory/hosts.example.yml` | An example server (a documentation address, not a real host) |
| `roles/lifeos/defaults/main.yml` | Every setting, with the same paths as the Bash installer |
| `roles/lifeos/tasks/main.yml` | The steps above, each one idempotent |
| `roles/lifeos/templates/lifeos.env.j2` | The environment file the service reads |
| `roles/lifeos/handlers/main.yml` | Reloads systemd and restarts LifeOS, only when something changed |
| `molecule/default/` | The Molecule test: a disposable Ubuntu container with systemd |

## Tests

`molecule test` creates an Ubuntu 22.04 container with systemd, runs the role, runs it a
second time and fails if the second run reports any change. Then it checks that the service
is active and enabled, that sign-in works, that a marker file in the data directory survived
both runs, and that the environment file has mode 0640. Continuous integration runs this in
`.github/workflows/ansible-role.yml`, together with `ansible-lint` and a syntax check.

Molecule needs Docker, so it runs in GitHub Actions. On a machine without Docker, run the lint
and syntax checks only: `ansible-lint` and `ansible-playbook --syntax-check playbook.yml`.

## Limits

- Debian and Ubuntu only. Other systems should use `deploy/linux/install.sh`.
- The role does not install the nightly backup timer. The Bash installer still does that.
- Old releases stay in `/opt/lifeos/releases`. Delete the ones you do not need.
- The role does not open a firewall port or set up HTTPS. The [self-hosting guide](../../docs/self-host-linux.md) covers access through an SSH tunnel.
