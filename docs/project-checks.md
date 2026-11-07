# Checks and documentation


The [budget view guide](../docs/react-migration.md) explains how this screen is built
and how to use the same approach for another screen.

The phone client uses React Native with Expo and TypeScript. Its schedule and
deadline dates come from the same typed date model as the web workload view.
`cd mobile && npm ci && npm run typecheck && npm test && npm run export` checks
the client with 12 native tests and creates Android, iOS and web bundles. Six
shared date-model tests run with the web suite. CI also runs a browser
walkthrough of the exported client, including a restart with the feed offline.
Native device testing and app-store distribution are not included in that check.

```sh
make test
make build
make lint
npm run typecheck
npm run privacy
```

With kubectl and kubeconform installed, `npm run test:kubernetes` runs eight
manifest checks, including strict validation of five cluster objects in each
configuration. CI also pulls the published app image into a fresh cluster, saves
a fictional note, replaces the app and rolls back a revision while checking the
same note. The [cluster guide](../docs/kubernetes.md#repeat-the-checks) explains how
to repeat these checks.

The [notes question guide](../docs/notes-questions.md) explains the LangChain pipeline,
which connects the search steps and local models. `npm run test:notes` runs 14
focused tests, including the real Ollama adapters against a fake local server.
CI runs these tests without model downloads. In a separate check with two real
local models and three fictional notes, both supported questions returned the
right source quote and an unrelated question returned the unknown answer.

For saved-text answers, `npm run rag:download && npm run test:rag` runs twelve
focused checks and a labelled set of fictional questions with the real local
model. At the default relevance cutoff, the expected source appears in the top
three for 12 of 14 answerable questions (85.7% recall at three), and all four
unknown questions receive an abstention. Two answerable questions also receive
an abstention. This small set checks regressions, not general answer accuracy.
`npm run test:rag:browser` checks typed questions, citations and abstention on
desktop and phone layouts. CI runs both and uploads the question-by-question report.

For support tickets, `npm run test:support` runs nine provider and routing tests.
`npm run support:evaluate` measures source hits and escalation on 14 labelled
fictional tickets with the real local model. The [support guide](../docs/support-assistant.md)
explains the decisions and honest limits. The full local suite passed 389 Node
tests and 19 React tests, with four optional service tests skipped.

The [local reference](../docs/local-workspace.md#testing) also covers browser tests.
I also keep a local build desk for checking a change before packaging it. Jenkins,
a tool that runs saved build steps, reads my [Jenkinsfile](../Jenkinsfile) from Git.
After installing dependencies, it runs lint (code checks), type checking, unit
tests and the privacy scan in parallel, saves the test reports, then builds the
same runtime Docker image I use locally. I can start it with
`docker compose -f deploy/jenkins/compose.yaml up --build -d --wait` after setting
a local admin password, then open <http://127.0.0.1:8081> and choose
**lifeos-open → Build Now**. The [Jenkins guide](../docs/jenkins.md) has the exact setup,
linter command and cleanup steps.

This mirrors the install, lint, type, test and privacy commands in my
[GitHub Actions workflow](../.github/workflows/ci.yml), which runs checks on GitHub
when I push a change. Jenkins uses SQLite and adds saved JUnit reports, a standard
test-results format; GitHub Actions also checks PostgreSQL, the optional Redis cache, browser behavior and
real offline transcription. A separate [Jenkins workflow](../.github/workflows/jenkins.yml)
starts the real server, uses its official linter and runs the whole pipeline on
each pull request and on main. This checks that the local setup keeps working.

Tests use fictional records and controlled providers. With Redis running,
`TEST_REDIS_URL=redis://127.0.0.1:6379 npm run test:cache` checks 18 cache cases,
and `REDIS_URL=redis://127.0.0.1:6379 npm run benchmark:cache` compares read
latency. In a 60-read test, cache hits avoided all 60 record-payload queries. The task-label experiment
adds 13 focused checks and a real browser walkthrough for both labels, consent,
reloads and downloaded counts. CI runs these checks too. The
[verification notes](../docs/verification.md), [route inventory](../docs/api-routes.json)
and [demo audit](../docs/demo-audit-2026-10-22.md) describe the checked paths and limits.
The [contribution guide](../CONTRIBUTING.md) explains changes to the project.

The optional study desk adds 36 focused checks for the public feed, component
states, scheduling, typed APIs, citations and account access. I compare retrieval
with nine fixed questions and run five browser journeys in CI. Separate service
checks use real Redis and PostgreSQL and a local AWS emulator. The
[study desk guide](../docs/study-desk.md#checks-and-cleanup) explains how I repeat
those checks and stop their disposable resources.

## Browser checks

After installing the app, run `npx playwright install chromium` once, then
`npm run test:browser`. The checks use a temporary local copy of the public demo
and fictional data. On my local run, 2 tests passed in 1.7 seconds. GitHub Actions
runs them for each pull request and saves a screenshot and trace when the demo
journey fails. Open a trace with `npx playwright show-trace test-results/browser/trace.zip`.

I can also make a small inventory of public pages with
`node tools/page-inventory.mjs https://example.com /`. It writes titles and first
headings to `page-inventory.json`; rerunning replaces the file. It checks the site's
robots.txt instructions, waits between requests, retries temporary failures and
only visits the paths I provide. Use it only on public pages I am allowed to read.

## Live notes and reviewed connections

Seven real-socket and browser-client tests cover recorded chunks, ordering,
reconnects, busy workers, errors and final flush. CI also drives the real
microphone page and local Whisper model. Nine syllabus tests cover the optional
Claude tool call, chosen context, local fallback and confirmed calendar writes.
Five MCP client/worker tests exercise both transports, scopes, rate limits,
validation, retries and job deadlines.

The [connection checks](connection-checks.md) run three C# Selenium/NUnit browser
journeys, four real boto3/Moto publisher cases, a real Terraform container
apply-and-destroy and a ZAP baseline scan. Separate Linux checks use actual
PostgreSQL/pgvector and the Go Lambda on LocalStack. The review desk check
provisions the real pinned Budibase service, drives its published form and
requires its audit automation to write a row. Make's check also confirms an
unchanged build is skipped, a changed public input rebuilds, and a missing
output is regenerated.
