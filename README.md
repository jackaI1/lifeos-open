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
notebook to try its labelled transcript.

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

The default assistant uses scripted example replies. Real chat needs a configured
provider, which receives the selected context and images. Live email sending is
not implemented; drafts can be composed and exported.

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

SQLite, the default database, keeps records in a local file. PostgreSQL is an
alternative database that runs as a separate service. For that setup,
follow the [database guide](docs/postgresql.md), including the transfer command
for an existing SQLite workspace. The transfer checks the copied records and
files and refuses a populated destination. Keep a backup first.

## Optional connections

If I want coursework reminders in Microsoft 365, the
[connection guide](integrations/m365/README.md) explains how to copy tasks from
the SQLite workspace to SharePoint, Microsoft's shared-list service, and import
a daily reminder workflow for Teams messages and Outlook email. It needs an account with the required permissions. Sync is one-way and
runs only when requested; it does not change the LifeOS workspace. A live tenant
connection still needs its own check.

The public demo can optionally collect a small set of usage events after a
visitor agrees. The [analytics guide](docs/analytics.md) explains setup and what
is sent. It stays off until the public build has valid identifiers configured;
the standalone workspace does not load analytics.

For a browser-only build or hosting the fictional demo, see
[HOSTED_DEMO.md](HOSTED_DEMO.md). These options are separate from the private
LifeOS service and include no private credentials or records.

There is also an [optional Amazon Web Services (AWS) hosting guide](docs/deploy-aws.md) for the
browser-only demo. It prepares the infrastructure and tagged releases for a
separate host; it has not been deployed or checked against a live AWS account.
Running it needs an AWS account and can incur charges. The usual public demo
continues to use Cloudflare, the service hosting its public files.

## Checks and documentation

The [budget view guide](docs/react-migration.md) explains how this screen is built
and how to use the same approach for another screen.

```sh
npm test
npm run build
npm run lint
npm run typecheck
npm run privacy
```

The [local reference](docs/local-workspace.md#testing) also covers browser tests.
Tests use fictional records and controlled providers. The
[verification notes](docs/verification.md), [route inventory](docs/api-routes.json)
and [demo audit](docs/demo-audit-2026-10-22.md) describe the checked paths and limits.
The [contribution guide](CONTRIBUTING.md) explains changes to the project.

## Demo

https://github.com/user-attachments/assets/5397817a-6c90-41f8-9ad9-6138a0c4023d

## License

MIT; see [LICENSE](LICENSE). Dependency and asset terms are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), with synthetic media provenance
in [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md).
