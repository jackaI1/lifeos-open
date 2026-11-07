# LifeOS Open

I built a personal workspace for my schedule, coursework and lecture notes because
keeping deadlines, handwritten notes and recordings in separate places made it
hard to plan my day and find the right part of a lecture later.

## Keep a cluster copy up to date

I can also run the fictional workspace on my own Kubernetes cluster, a system for running containers. Flux checks this repository and pulls the saved deployment settings into the cluster, so a reviewed change can be applied without manually editing the running copy. It also corrects configuration drift, such as an accidental change to the number of running copies. This is an optional experiment and does not change the public browser demo. The [cluster setup guide](docs/gitops.md) has the commands, storage requirements and limitations.

## Overview

I kept needing the schedule, the deadline and the notes behind a task together.
In LifeOS, I can start with today's commitments, open the coursework behind a
deadline, then return to a lecture's slides, handwriting and audio on one
timeline. I also keep budgets, photos and journal entries in the workspace.

This is the public edition of my personal project. It starts with fictional
courses, contacts and records, with no private workspace history. Try the
[browser demo](https://lifeos.jacklai.ca) without signing in, or run it locally
with the commands below. In the demo, open **School → Lectures** and a sample
notebook to try its labelled transcript. Open **Academics → Week workload** to
compare the week’s commitments and see which courses have deadlines together.

I also made a small [Today view](apps/today) that shows the fictional schedule
and upcoming deadlines. To try it locally, run `npm ci --prefix apps/today`,
then `npm run dev --prefix apps/today` and open http://localhost:3000. The
refresh button reloads the public sample, and the links above the list work
with a keyboard. This separate view does not change the hosted demo.

In that study desk, **Report plan** helps me try a fictional lab report's task
order and see which delays move the finish. **Public guide** answers questions
with linked quotations from my public instructions. **Pick trials** lets me
compare simulated camera error and gripper tolerance. The
[study desk guide](docs/study-desk.md) explains the optional database and Python
service, with exact commands. These examples do not read my private notes or
control real equipment.

I can ask the local assistant about saved notes and calendar entries, then check
the passages behind its answer. If nothing is relevant enough, it says it does
not know. The [saved-text setup](docs/retrieval.md#try-it) takes two commands after
installing the app. This runs on my computer; the browser demo keeps its scripted
example questions.

When setup goes wrong, I can describe the problem to a read-only support
assistant. It looks up my troubleshooting instructions, quotes the relevant
steps and hands uncertain or high impact tickets back to me. After the same
local model setup, I run `npm run support -- "My retrieval embedding files are unavailable"`.
The [support guide](docs/support-assistant.md) includes examples and an optional
Azure connection for written answers. The default keeps the question and search
on my computer.

I can also check the fictional day's schedule and upcoming deadlines in the
phone client. From this checkout, run `cd mobile`, `npm ci`, then `npm start`
and open it in Expo Go, an app that runs the phone preview. **Refresh** downloads
the public examples; the last saved copy stays available without a connection.
The [phone guide](docs/mobile.md) covers setup, retry states and the browser preview.

I can also serve those public examples from a small cloud endpoint, a web address
that returns the schedule and deadlines. It reads a separate database containing
only the fictional feed, so the phone demo can refresh without my personal
workspace running. From `integrations/azure-feed`, I run `npm ci`,
`npm run build` and `npm run dev` after the
[feed setup](docs/azure-feed.md#try-it-locally). That starts a disposable local
copy and prints its address; Ctrl-C cleans it up. The same guide covers running
it on Azure and pointing the phone client at its address.

I also keep a small browser check for the public demo. It opens the main screens,
adds and completes a fictional task, and checks basic page landmarks. If a change
breaks the journey, the automated check saves a screenshot and a trace, a recording
of the browser steps, to help me investigate.

## Run it locally

Install Node.js 24 or newer, then run:

```sh
git clone https://github.com/jackaI1/lifeos-open.git
cd lifeos-open
npm ci
npm run dev
```

Open <http://127.0.0.1:8787>. First launch creates a local database and a fictional
workspace with an upcoming lab and sample lecture. No account or API key is
needed. Stop with Ctrl-C. Settings lets me change themes and [time format](docs/time-format.md), and
save a backup. The [local guide](docs/local-workspace.md) covers configuration,
restoring backups and running an empty workspace.

Docker packages the app with its runtime; Compose starts that package and its
storage together. With Docker and Compose v2 installed, I can instead run:

```sh
docker compose up --build
```

Open the same address. The database stays in the `lifeos-data` volume when I stop
it with `docker compose down`. Adding `-v` deletes that stored data. The
[container instructions](docs/local-workspace.md#run-with-docker) cover image and
port settings.

## Using the workspace

I use **Today** to see commitments and tasks, then **School** to find coursework,
deadlines and study material. In a lecture notebook, I can write over slides,
record audio and replay my notes against the recording. [Notebook notes](docs/notebook-persistence.md)
explain how slides stay attached across navigation. Saved drafts and queued edits help
preserve work through a lost connection, but a full offline reload is not supported.
The [screen guide](docs/features.md) describes the other views.

I use **Academics → Week workload** when a task list makes every deadline look
separate. The weekly timeline compares calendar hours with the remaining work
due each day, and the deadline heat map groups task counts by course and day.
I can move between weeks, hover or Tab to a chart mark for details, then click
or press Enter to open its task links. Unknown dates and estimates stay visible.
These totals help me spot clusters; they do not reserve study time or measure
free time. The [chart guide](docs/workload.md) explains the counting rules.

In **Finances**, I can track spending and see what is left for the current week,
month or year. I can add transactions, change their categories, and review
allowances or the spending forecast. Saved transactions survive a reload in
both the standalone workspace and the browser demo.

For a saved lecture recording, I can make a transcript on my computer and select
a sentence to replay its audio beside nearby handwritten notes, including notes
on another page or after a recording pause. After the separate
[transcription setup](docs/whisper.md#setup-macos-or-linux), I open
**School → Lectures**, record in a notebook, pause and let the audio save, then
choose **Transcript → Transcribe locally**. On a phone, Transcript is under
**More**. I refresh the transcript and select a timestamp to listen again.

Whisper, a speech-recognition model, runs on my computer after its initial
download. A background worker checks the saved audio and saves timestamped text
while I keep using the notebook. The public browser demo has a labelled sample;
real recognition runs in the local edition.

I tested the real worker on an 11-second public-domain clip: two timestamped
segments with 0.0% word error rate. That is one clean English recording, so I still
check lecture transcripts against the audio. The [transcription guide](docs/whisper.md)
includes the repeatable evaluation, setup and worker design.

I can ask a question about my saved notes from the local checkout. After the
[local model setup](docs/notes-questions.md#try-it-locally), I run
`npm run notes -- ask "How does negative feedback work?"`. It searches my typed
notes, study notes and saved lecture transcripts, then shows exact quotes with
the source note title and passage number. If it finds no relevant evidence,
it says it does not know. This runs on my computer with a separate local model;
the browser demo does not answer these questions. I still open the source to
check whether a quote answers what I meant.

The default assistant uses scripted example replies. To ask my own questions
about saved text, I run `npm run rag:download` once, then start the app with
`RAG_MODE=local npm run dev`. I open **School → Academic advisor**, type
"What should I bring to the Systems lab?", and get the saved passage with a
numbered source. I can add or edit a note and ask again without rebuilding an
index by hand. No chat API key is needed for quoted answers.

The local model turns passages into lists of numbers called embeddings, which
let the assistant find related wording. SQLite and its sqlite-vec extension store
and compare them beside the workspace. A LangChain sequence connects search to
the answer and its checked sources.
A configured chat provider can write an answer using just the retrieved passages;
I check its citations against those passages. Other real chat features still need
a configured provider, which receives their selected context and images. The
[retrieval guide](docs/retrieval.md) explains setup, privacy and limitations.
Live email sending is not implemented; drafts can be composed and exported.

The browser demo saves changes and uploads only in that browser. Clearing site
data can remove them, and there is no cross-device sync. Its chat accepts the
provided example questions; schedule examples make local changes with Undo.
It uses the same fictional material as the [demo video](#demo) and
[screenshots](docs/screenshots/today.png).

## Keeping it running elsewhere

For a Linux machine that stays on, the [self-hosting guide](docs/self-host-linux.md)
sets up the service, daily backups and upgrades that can switch back if startup
fails. It also explains how to uninstall it and how to reach it through an SSH
tunnel, an encrypted connection to that machine.

If I already have a cluster, I can also run the workspace with
[Kubernetes](docs/kubernetes.md), which keeps the app running and connects it to
a separate disk. My notes stay on that disk when I replace the app. The guide
starts with a local test cluster, shows how to open the workspace through a local
tunnel, and covers backups, updates and switching back to an earlier version.
This setup runs one copy of the app and briefly stops it during updates.

SQLite, the default database, keeps records in a local file. PostgreSQL is an
alternative database that runs as a separate service. For that setup,
follow the [database guide](docs/postgresql.md), including the transfer command
for an existing SQLite workspace. The transfer checks the copied records and
files and refuses a populated destination. Keep a backup first.

For repeated reads of saved tasks, reminders and coursework, I can turn on an
optional Redis cache, a temporary copy kept in memory. Every saved change makes
the previous copy unusable, and the API reads the database if Redis is down.
After `npm ci`, `docker compose --profile redis up -d --wait redis` starts it;
`REDIS_URL=redis://127.0.0.1:6379 npm run dev` uses it. I stop it with
`docker compose --profile redis down`. The [cache guide](docs/redis-cache.md)
shows how to check hits, test an outage and compare read latency. It stays off
by default because a small local database can be faster without it.

I also made a [public instruction publisher](docs/study-desk.md#publish-public-instructions)
so I could learn how to turn a versioned set of Markdown pages into a checked,
searchable site. It rejects broken local links, queues builds, and reuses unchanged
pages. The separate [account examples](docs/study-accounts.md) let me try repeated
requests, concurrent settlements and selective access to fictional balances.
They are learning tools beside LifeOS, with no real accounts or money.

## Optional connections

If I want coursework reminders in Microsoft 365, the
[connection guide](integrations/m365/README.md) explains how to copy tasks from
the SQLite workspace to SharePoint, Microsoft's shared-list service, and import
a daily reminder workflow for Teams messages and Outlook email. It needs an account with the required permissions. Sync is one-way and
runs only when requested; it does not change the LifeOS workspace. I can keep tasks
without a deadline in the shared list; the reminder workflow skips them and keeps
the reminders for tasks due tomorrow. A live tenant
connection still needs its own check.

I want to know which demo screens people try and whether they go on to add
something. The public demo can use Google Analytics 4 (GA4), which counts visits
and actions, through Google Tag Manager (GTM), which controls the reporting tags.
It waits for the visitor's permission and sends fixed categories rather than
task titles, notes or spending amounts. It stays off until I configure the public
build; the standalone workspace does not load it.

I can run `npm run analytics:check` after `npm ci` to check the reporting setup
without a Google account. It walks through fictional task and budget changes,
checks the saved tag configuration and prints the resulting counts. The
[analytics guide](docs/analytics.md) explains the local report, live setup and
how I can compare a screen visit with a later action.

I also want to know whether the task button makes sense to a new visitor. In the
browser demo, **Academics** compares **New task** with **Plan a task** and counts
whether I save a task after seeing it. After I allow analytics, a random browser
identifier keeps the same version on reload. The counts stay on this device;
**Task label experiment** shows them and lets me download them. Declining keeps
counting off, and withdrawing permission erases the experiment log.

After `npm ci`, `npm run experiment:report` runs a small and a large fictional
comparison. The small one says **not enough data**. A real comparison needs at
least 1,094 exposed browsers per version and a completed observation window;
one browser cannot establish a winner. The [experiment guide](docs/experiments.md)
shows how to run the demo, read conversion rates and their uncertainty, and use
the two-proportion test, a check for a difference between two conversion fractions.
There is no central collection service in this version.

For a browser-only build or hosting the fictional demo, see
[HOSTED_DEMO.md](HOSTED_DEMO.md). These options are separate from the private
LifeOS service and include no private credentials or records.

There is also an [optional Amazon Web Services (AWS) hosting guide](docs/deploy-aws.md) for the
browser-only demo. It prepares the infrastructure and tagged releases for a
separate host; it has not been deployed or checked against a live AWS account.
Running it needs an AWS account and can incur charges. A smaller [static AWS option and an optional Azure container deployment](docs/study-cloud.md) have separate templates and deployment workflows. Both are account-configured options; neither has been provisioned by these tests. The usual public demo
continues to use Cloudflare, the service hosting its public files.

## Checks and documentation

The [budget view guide](docs/react-migration.md) explains how this screen is built
and how to use the same approach for another screen.

The phone client uses React Native with Expo and TypeScript. Its schedule and
deadline dates come from the same typed date model as the web workload view.
`cd mobile && npm ci && npm run typecheck && npm test && npm run export` checks
the client with 12 native tests and creates Android, iOS and web bundles. Six
shared date-model tests run with the web suite. CI also runs a browser
walkthrough of the exported client, including a restart with the feed offline.
Native device testing and app-store distribution are not included in that check.

```sh
npm test
npm run build
npm run lint
npm run typecheck
npm run privacy
```

With kubectl and kubeconform installed, `npm run test:kubernetes` runs eight
manifest checks, including strict validation of five cluster objects in each
configuration. CI also pulls the published app image into a fresh cluster, saves
a fictional note, replaces the app and rolls back a revision while checking the
same note. The [cluster guide](docs/kubernetes.md#repeat-the-checks) explains how
to repeat these checks.

The [notes question guide](docs/notes-questions.md) explains the LangChain pipeline,
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
fictional tickets with the real local model. The [support guide](docs/support-assistant.md)
explains the decisions and honest limits. The full local suite passed 356 Node
tests and 19 React tests, with three optional service tests skipped.

The [local reference](docs/local-workspace.md#testing) also covers browser tests.
I also keep a local build desk for checking a change before packaging it. Jenkins,
a tool that runs saved build steps, reads my [Jenkinsfile](Jenkinsfile) from Git.
After installing dependencies, it runs lint (code checks), type checking, unit
tests and the privacy scan in parallel, saves the test reports, then builds the
same runtime Docker image I use locally. I can start it with
`docker compose -f deploy/jenkins/compose.yaml up --build -d --wait` after setting
a local admin password, then open <http://127.0.0.1:8081> and choose
**lifeos-open → Build Now**. The [Jenkins guide](docs/jenkins.md) has the exact setup,
linter command and cleanup steps.

This mirrors the install, lint, type, test and privacy commands in my
[GitHub Actions workflow](.github/workflows/ci.yml), which runs checks on GitHub
when I push a change. Jenkins uses SQLite and adds saved JUnit reports, a standard
test-results format; GitHub Actions also checks PostgreSQL, the optional Redis cache, browser behavior and
real offline transcription. A separate [Jenkins workflow](.github/workflows/jenkins.yml)
starts the real server, uses its official linter and runs the whole pipeline on
each pull request and on main. This checks that the local setup keeps working.

Tests use fictional records and controlled providers. With Redis running,
`TEST_REDIS_URL=redis://127.0.0.1:6379 npm run test:cache` checks 18 cache cases,
and `REDIS_URL=redis://127.0.0.1:6379 npm run benchmark:cache` compares read
latency. In a 60-read test, cache hits avoided all 60 record-payload queries. The task-label experiment
adds 13 focused checks and a real browser walkthrough for both labels, consent,
reloads and downloaded counts. CI runs these checks too. The
[verification notes](docs/verification.md), [route inventory](docs/api-routes.json)
and [demo audit](docs/demo-audit-2026-10-22.md) describe the checked paths and limits.
The [contribution guide](CONTRIBUTING.md) explains changes to the project.

The optional study desk adds 36 focused checks for the public feed, component
states, scheduling, typed APIs, citations and account access. I compare retrieval
with nine fixed questions and run five browser journeys in CI. Separate service
checks use real Redis and PostgreSQL and a local AWS emulator. The
[study desk guide](docs/study-desk.md#checks-and-cleanup) explains how I repeat
those checks and stop their disposable resources.

## Demo

https://github.com/user-attachments/assets/5397817a-6c90-41f8-9ad9-6138a0c4023d

## License

MIT; see [LICENSE](LICENSE). Dependency and asset terms are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), with synthetic media provenance
in [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md).

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


## Other things I've built here

- [agent-tool-eval](projects/agent-tool-eval/)
- [cdp-browser-agent](projects/cdp-browser-agent/)
- [clip-export-tool](projects/clip-export-tool/)
- [edge-vision-quantization](projects/edge-vision-quantization/)
- [experiment-analysis](projects/experiment-analysis/)
- [hls-rtmp-streaming-lab](projects/hls-rtmp-streaming-lab/)
- [hnsw-vector-search](projects/hnsw-vector-search/)
- [lifeos-android](projects/lifeos-android/)
- [lifeos-ios](projects/lifeos-ios/)
- [lifeos-mobile-expo](projects/lifeos-mobile-expo/)
- [llm-lora-sft-eval](projects/llm-lora-sft-eval/)
- [nextjs-run-dashboard](projects/nextjs-run-dashboard/)
- [offline-bandit-eval](projects/offline-bandit-eval/)
