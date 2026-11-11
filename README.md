# LifeOS Open

I built a personal workspace for my schedule, coursework and lecture notes because
keeping deadlines, handwritten notes and recordings in separate places made it
hard to plan my day and find the right part of a lecture later.

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

For a local checkout, I use `make install` to install the locked dependencies,
`make build` to build the app, and `npm start` to run it. `make help` lists the
other shortcuts: `make lint`, `make test`, and `make docker` (which needs Docker).
The build checks its input files and skips work when they have not changed. The
main CI job uses the same commands and checks that a second build is skipped.

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

I can also read a short spoken note as I record it. After the
[local speech setup](docs/live-voice.md#setup), I open a lecture notebook's
**Transcript → Open live microphone transcript**, choose **Start microphone**,
and use **Finish recording** to collect the last few seconds. Timestamped text
arrives in small pieces; a brief lost connection keeps unfinished audio for retry.

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

## Starting a theme from a Figma file

I built a small import that takes the colours of a theme from a design file
because typing six-digit colour codes into Settings by hand is slow and easy to
get wrong. Figma is a design tool that is widely used for app screens. In it, a
**style** is a named colour that every shape can share. I made three Fill styles called `Theme/Primary`, `Theme/Display` and
`Theme/Chassis`. The tool in [`tools/figma-theme.mjs`](tools/figma-theme.mjs)
reads those styles, converts each colour to the six-digit codes LifeOS uses,
and prints a custom theme. It runs the result through the same check Settings
uses, so a bad colour is caught before I touch the app.

To try it, run `npm run theme:figma -- --file design.json --name "My theme"`
with a saved Figma file, or give it a file key and a token with `--key`. The
output lists the name and three colours. I then open Settings, choose Theme,
press Customize and type them in. The setup steps, including where to find the
file key, are in [docs/figma-theme.md](docs/figma-theme.md).

The tests in [`test/figma-theme.test.mjs`](test/figma-theme.test.mjs) use a
made-up file in Figma's format, so they run without an account. They cover the
colour conversion, a missing style, a gradient or see-through fill, a fetch that
is refused, and the command line. The limit is that the tool reads only solid
Fill styles. Gradients and images stop the import with a message.

## Exporting coursework to Microsoft Project

I built an export because I wanted my coursework deadlines and work estimates in a file that Microsoft Project can open. Project is a scheduling program that many engineering teams use to track tasks against dates, and I wanted to learn how a real project plan is put together. The export reads the tasks in **School** and writes one file. Each course becomes a summary row, each task sits under its course, and its length comes from the minutes I still expect it to take.

Every due date becomes a "Finish no later than" rule. When I open the file, Project marks any task that cannot finish before its deadline at the planned pace. Drafts, notes, next steps and links are never written to the file, so it holds only titles, lengths, percentages done and dates.

To export my own plan, I keep LifeOS running and open `http://localhost:8787/api/export` in the same browser (8787 is the default port of the local server). I save that page as `lifeos-export.json`, then run:

```bash
npm run export:project -- --input lifeos-export.json --out school-plan.xml
```

To see the feature with the fictional demo data, run `npm run export:project -- --demo --out demo-plan.xml`. In Microsoft Project, I choose **File > Open** and pick the `.xml` file. The command refuses to overwrite a file that already exists, so an older plan is never lost.

The code is in [`src/domain/school-project.mjs`](src/domain/school-project.mjs) and the command is in [`tools/export-school-project.mjs`](tools/export-school-project.mjs). Limitation: I have not opened these files in Microsoft Project on my own computer yet. The tests check that the XML is well-formed and that the fields follow Project's XML format, but they cannot check how Project itself displays the schedule. Project calculates the dates from the durations, and task dependencies are not exported yet.

## Keeping it running elsewhere

For a Linux machine that stays on, the [self-hosting guide](docs/self-host-linux.md)
sets up the service, daily backups and upgrades that can switch back if startup
fails. It also explains how to uninstall it and how to reach it through an SSH
tunnel, an encrypted connection to that machine.

I also wrote an [Ansible role](deploy/ansible/README.md) that does the same install
as the Bash scripts. Ansible runs a list of steps from a file I keep in version control.
The role installs the packages, the service user, Node.js and the systemd unit, then
keeps my access token and data when I run it again. It only changes what is out of date.
Its Molecule test runs the role twice in a disposable container and fails if the second
run changes anything.

If I already have a cluster, I can also run the workspace with
[Kubernetes](docs/kubernetes.md), which keeps the app running and connects it to
a separate disk. My notes stay on that disk when I replace the app. The guide
starts with a local test cluster, shows how to open the workspace through a local
tunnel, and covers backups, updates and switching back to an earlier version.
This setup runs one copy of the app and briefly stops it during updates.

I can also run the fictional workspace on my own Kubernetes cluster, a system for running containers. Flux checks this repository and pulls the saved deployment settings into the cluster, so a reviewed change can be applied without manually editing the running copy. It also corrects configuration drift, such as an accidental change to the number of running copies. This is an optional experiment and does not change the public browser demo. The [cluster setup guide](docs/gitops.md) has the commands, storage requirements and limitations.

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

## Running the demo on Azure

I also run the fictional public demo as a container on Azure Container Apps, a
service that runs a container and scales it to zero when nobody is visiting. The
infrastructure is described in [Bicep](deploy/azure/main.bicep), Azure's template
language, so I can rebuild the same setup from the repository. The demo's secret
lives in Azure Key Vault, a secure store, and the container reads it through a
managed identity, an Azure login the app is given. No secret is written into the
code or an environment file. A GitHub Actions workflow tests the template and the
image, then deploys on merge to `main` and rolls back if the health check fails.

**What it costs.** The Consumption plan of Container Apps includes a monthly free
grant of 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests. With
0.25 vCPU and 0.5 GiB, that grant covers about 200 hours of running time a month.
The demo scales to zero, so an idle month costs close to nothing; a copy kept awake
all month would go past the grant. Key Vault and the Log Analytics workspace add
small charges. The workspace is capped at 1 GB of logs a day. I checked the free
grant on Microsoft's pricing page but not the paid rates, so look those up on the
[Container Apps pricing page](https://azure.microsoft.com/pricing/details/container-apps/)
before relying on a number. [The Azure guide](docs/azure-container-apps.md) has the
setup, rollback and cleanup steps.

## Optional connections

In the local **Settings → Connections**, I can choose a local model or the optional
Claude connection for [syllabus review](docs/assistant-connections.md). I paste
only the text I want to share, check the dated proposals, then confirm before
saving any events. The page names the answering provider and explains a fallback.

If I want coursework reminders in Microsoft 365, the
[connection guide](integrations/m365/README.md) explains how to copy tasks from
the SQLite workspace to SharePoint, Microsoft's shared-list service, and import
a daily reminder workflow for Teams messages and Outlook email. It needs an account with the required permissions. Sync is one-way and
runs only when requested; it does not change the LifeOS workspace. I can keep tasks
without a deadline in the shared list; the reminder workflow skips them and keeps
the reminders for tasks due tomorrow. A live tenant
connection still needs its own check. On my Linux server, a systemd timer can run
the sync every hour; [`install-timer.sh`](integrations/m365/deploy/install-timer.sh)
installs it, and the connection guide explains which account it runs as.

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

I also wanted to learn how to connect small review and import tools without using
private records. My [fictional review desk](docs/review-desk.md) has a Budibase
review form, an audit trail, a clean-up queue and source citations from a self-made
PDF form. Its separate relational asset registry has saved water/sewer inspection
queries and a report I can open in Excel. Diagnosis and signature fields stay
blank in the PDF example.

For a compatible local agent, my [schedule tools](docs/mcp.md) can read commitments
and deadlines and queue validated tasks with a scoped token. I can poll a job id
to see when a write finishes. The [shift-report search](docs/shift-search.md)
compares word search with a local model's similarity search and returns the exact
fictional source passage. The [record importer](docs/fhir-ingest.md) checks public
FHIR health-record examples and quarantines missing or unsupported values, with
an optional S3-to-Lambda-to-DynamoDB path tested in an AWS emulator.

## Test suite for the demo

I built a test suite for the public demo because I want to know that its main screens still work before I change them, and clicking through them by hand after every edit is slow. Each change runs the same checks, so a broken schedule or deadline should show up before it reaches the demo.

The suite has three parts. Selenium drives Chrome the way a person would, without showing a window. It adds an event on Today, creates a task in School, moves that task’s deadline, and compares the Today schedule with the saved data. Postman, a tool for writing requests to a web app, and its command-line runner, Newman, send requests straight to the app’s API. Each request is one row in a table, and many rows are bad input: an event that ends before it starts, a missing security token or an out-of-date version. The app has to refuse those with the right error. Jenkins is a build server. Its pipeline runs the unit, API and browser stages in a pinned container and keeps their reports.

All of the data is fictional. Each run starts its own copy of the demo with a temporary database, records which process and port it used, and removes both afterwards, so my workspace is never touched.

To run the API checks, use `npm ci`, `npm run build` and `npm run test:api`. The browser checks need Chrome and Python: `python3 -m pip install -r test/selenium-python/requirements.txt`, then `npm run test:selenium`. The [test guide](docs/api-and-browser-tests.md) explains the tables, the settings and the cleanup.

### Latest results

On my last CI run for this change, the API checks sent 42 requests from four tables and made 86 checks with 0 failures. The browser checks ran 4 tests in headless Chrome in 17.7 seconds with 0 failures. The Jenkins pipeline built the app and ran 508 tests, then archived four reports. Each run stopped its temporary workspace and deleted its database afterwards.

## Performance tests

I built a load-test suite for LifeOS because I want to know how many people my own server can handle before I invite anyone else. [Apache JMeter](https://jmeter.apache.org/), a load-testing program, signs in as simulated users, reads and writes calendar events, looks up tasks and pauses between actions. Four plans cover a single-user baseline, a ramped load, a stress run past my expected use and a two-hour endurance run.

While each plan runs, the script records the server's CPU, its memory, the time that SQLite takes for two fixed reads and Node's garbage-collection pauses. The report lists which checks passed or failed, and the endurance run flags memory that keeps rising, which can mean a leak. Each run starts a fresh server with fictional data and stops it afterwards.

The [performance guide](perf/jmeter/README.md) explains how to run the short smoke profile or a full plan, what each limit means and what the numbers do not prove. CI runs the analysis tests and the smoke profile on every change to the server or the tests.

## Checks and documentation

I run [C# browser checks](docs/connection-checks.md#browser-and-data-checks) with
Selenium and NUnit to add and edit a fictional schedule event and compare the
screen's dates and counts with the API. CI saves NUnit results and screenshots
on failure. My [security checks](SECURITY-TESTING.md) verify the public host's
headers, rejected remote writes and literal display of entered text, then scan
a locally served public build with OWASP ZAP.

The [deployment checks](docs/connection-checks.md) apply and destroy a disposable
Docker container through Terraform, check its health response, and test the
optional S3 feed publisher with emulated AWS permissions. The public container
writes structured health logs; its AWS template includes a CloudWatch alarm for
failed checks. These are tested local/emulated deployment paths, not a claim of
a new live AWS deployment. The normal live demo remains at
[lifeos.jacklai.ca](https://lifeos.jacklai.ca).

I test the workspace with fictional records before sharing changes. The [checks guide](docs/project-checks.md) explains how I run the tests and what they cover. The [contribution guide](CONTRIBUTING.md) explains how to make changes.

## Demo

https://github.com/user-attachments/assets/5397817a-6c90-41f8-9ad9-6138a0c4023d

## License

MIT; see [LICENSE](LICENSE). Dependency and asset terms are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), with synthetic media provenance
in [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md).

For my other experiments in this repository, see the [project index](docs/project-index.md).
