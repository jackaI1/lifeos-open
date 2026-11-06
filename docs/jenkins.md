# My local build desk

I want the same checks to work on my own machine as on GitHub, with a saved test
report when something breaks. Jenkins reads the build steps from `Jenkinsfile`
instead of relying on steps I entered in a web form. It packages the working app
into a local Docker image after the checks pass. It does not deploy or publish it.

## Start and run a build

Install Docker with Compose v2. From the repository root, choose a password in
the current shell. This is local configuration; do not save it in Git.

```sh
read -rs JENKINS_ADMIN_PASSWORD
export JENKINS_ADMIN_PASSWORD
# Linux: match the group that owns the Docker socket.
export JENKINS_DOCKER_GID=$(stat -c %g /var/run/docker.sock)
docker compose -f deploy/jenkins/compose.yaml up --build -d --wait
```

On macOS with Docker Desktop, leave `JENKINS_DOCKER_GID` unset (default `0`).
If the socket is elsewhere, set `JENKINS_DOCKER_SOCKET` to its path; for example,
use the socket path shown by `docker context inspect`. The controller needs
about 2 GB of available memory, plus space and memory for the app image build.

Open <http://127.0.0.1:8081>, sign in as `admin` with that password, choose
**lifeos-open**, then **Build Now**. The first run downloads dependencies and
image layers. **Console Output** shows each command, **Test Result** shows failed
and passed tests, and **Build Artifacts** contains the XML reports, privacy JSON
and Docker image ID. Images are named `lifeos-open:jenkins-1`, then `-2`, and so on.

The default job builds public `main`. To try a pushed branch, set
`LIFEOS_JENKINS_REF=skills/my-change` before starting a fresh controller. The YAML
configuration recreates the job at startup, so restart the service after changing
the reference. `JENKINS_PORT` changes the host port. No GitHub token is needed.

This setup is for reviewed code on a trusted local machine. The Docker socket
lets builds control the Docker host, even though Jenkins runs as a non-root user.
Do not expose its port publicly or connect it to automatic builds of untrusted
code. Hosted CI uses a disposable GitHub runner instead. A shared installation
should put builds on separate agents and use its own access controls.

## Validate an edit before running it

With Jenkins running and Node.js 24 installed:

```sh
npm run jenkins:lint
# Or validate another file:
node tools/jenkins-lint.mjs path/to/Jenkinsfile
```

The script uses `JENKINS_ADMIN_PASSWORD` from the shell. For another server, set
`JENKINS_URL`, `JENKINS_USER` and `JENKINS_TOKEN` (an API token). Remote servers
must use HTTPS. It authenticates, gets a CSRF crumb (a request-validation value)
with its session cookie, and posts the file to Jenkins's
[official Declarative linter](https://www.jenkins.io/doc/book/pipeline/development/#linter).
An invalid file exits unsuccessfully even when Jenkins responds with HTTP 200.
The linter checks pipeline syntax; only an actual build checks command behavior.

## What runs where

| Step | Jenkins | GitHub Actions |
| --- | --- | --- |
| Dependencies | Node 24, `npm ci` once before checks | Node 24, `npm ci` for each database job |
| Lint | `npm run lint`, parallel branch | Same command |
| Types | `npm run typecheck`, parallel branch | Same command |
| Tests | `npm run test:ci`, same Node and React suites with JUnit reports | `npm test`, SQLite and PostgreSQL, with Redis enabled |
| Privacy | `npm run privacy`, parallel branch, saved JSON | Same scan |
| App | `npm run build`, analytics check, committed bundle check | Same checks |
| Container | Existing Dockerfile's `runtime` target, local image | Docker workflow also smoke-tests, scans and publishes version tags |
| Extra integration | Jenkins server, official linter, SCM build and report assertions | Existing jobs also run browser, Linux hosting and offline Whisper checks |

Install precedes the parallel branches because they need `node_modules`. These
branches share read-only dependencies and only the test/privacy branches write
their own result files. Reports are collected even after failed tests. Jenkins
skips packaging when any check fails. It retains ten builds and five sets of
artifacts, limits a run to 25 minutes, prevents overlapping runs, and removes its
checkout after each run. The controller has one executor; the four check branches
still run concurrently within that build.

The local Jenkins job leaves the optional Redis cache off. Its normal and fallback
tests still run; live Redis integration tests are skipped there. GitHub Actions
starts a real Redis service for those tests and the cache benchmark.

`deploy/jenkins/Dockerfile` includes Node 24, the Docker command and Buildx (the
image builder). `plugins.txt` pins the directly selected plugins. Jenkins
Configuration as Code reads `jenkins.yaml` to set authentication and create the
Git-backed job using Job DSL, a small language for defining jobs. No manual job
creation or script approval is needed. Rebuild the controller image when changing
its plugins, toolchain or YAML. Transitive plugin dependencies and upstream image
tags can change; this is a reproducible setup recipe, not an immutable image lock.

## Repeat the integration check

On a Linux Docker host, with the commit pushed to the public repository:

```sh
bash deploy/jenkins/test.sh
```

The test uses a unique Compose project, an ephemeral password and port 18081.
It checks valid and deliberately invalid files with the actual linter, runs the
SCM job at the requested commit, asserts zero test failures, downloads four
artifacts and compares the built image ID. GitHub runs this automatically for
pull requests and `main` and saves the evidence for seven days. Fork pull requests
use the fork's public clone URL so their head commit is available to Jenkins.
The HTTP contract tests in `test/jenkins-lint.test.mjs` cover authentication,
crumb cookies, invalid HTTP-200 results and unavailable servers without Docker.

The integration script removes its containers, volume and tagged app image on
exit and verifies that its owned resources are gone. Its controller image and
Docker build cache remain reusable; it never prunes unrelated Docker resources.

## Stop and clean up

For the normal local installation:

```sh
docker compose -f deploy/jenkins/compose.yaml down
docker compose -f deploy/jenkins/compose.yaml ps -a
```

The second command should show no containers. The named `jenkins-home` volume
keeps login state, build history and reports for next time. To deliberately erase
that local Jenkins history, use `down --volumes` instead. Remove a retained app
image with `docker image rm lifeos-open:jenkins-1`, substituting its build number.
Avoid broad image or volume pruning, which can delete other projects' data.
