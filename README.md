# LifeOS Open

I built a personal workspace because I wanted my schedule, coursework and lecture notes in one place.

## Overview

I wanted to keep track of classes, deadlines and notes without leaving them in
separate places. LifeOS puts them together: I can see today's commitments, plan
coursework and keep lecture slides, handwriting and audio on the same timeline.
I can also keep records such as budgets, photos and journal entries.

This is the public edition of my personal project. It starts with fictional
courses, contacts and records, with no private workspace history. Try the
[browser demo](https://lifeos.jacklai.ca) without signing in, or run it locally
with the commands below.

## Run it locally

Install Node.js 24 or newer, then run from the repository root:

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:8787>. First launch creates a local database and a fictional
workspace with an upcoming lab and sample lecture. No account or API key is
needed. Stop with Ctrl-C. Settings lets me change themes and [time format](docs/time-format.md), and
save a backup. The [local guide](docs/local-workspace.md) covers configuration,
restoring backups and running an empty workspace.

With Docker and Compose v2, I can instead run:

```sh
docker compose up --build
```

Open the same address. The database stays in the `lifeos-data` volume when I stop
it with `docker compose down`. Adding `-v` deletes that stored data. The
[container instructions](docs/local-workspace.md#run-with-docker) cover image and
port settings.

## Using the workspace

Today brings together commitments and tasks. School keeps coursework, deadlines
and study material together. Lecture notebooks let me write over slides, record
audio and replay notes against the recording. [Notebook notes](docs/notebook-persistence.md)
explain how slides stay attached across navigation. Saved drafts and queued edits help
preserve work through a lost connection, but a full offline reload is not supported.
The [screen guide](docs/features.md) describes the other views.

In **Finances**, I can track spending and see what is left for the current week,
month or year. I can add transactions, change their categories, and review
allowances or the spending forecast. Saved transactions survive a reload in
both the standalone workspace and the browser demo.

For a saved lecture recording, I can optionally make a transcript on my computer
and select a sentence to replay the audio beside the nearest handwritten note.
The [local transcription guide](docs/whisper.md) covers the separate Python/model
setup and the Transcript controls. The initial model download needs a connection;
recognition then runs locally. The browser demo keeps its labelled sample
transcript, and recognition errors still need checking against the recording.

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
sets up the service, daily SQLite backups and upgrades with rollback. It also
explains access through an SSH tunnel and how to uninstall it.

SQLite is the default database. For a self-hosted PostgreSQL installation,
follow the [database guide](docs/postgresql.md), including the transfer command
for an existing SQLite workspace. The transfer checks the copied records and
files and refuses a populated destination. Keep a backup first.

## Optional connections

If I want coursework reminders in Microsoft 365, the
[connection guide](integrations/m365/README.md) explains how to copy tasks from
the SQLite workspace to a SharePoint list and import a daily Teams/Outlook reminder
flow. It needs an account with the required permissions. Sync is one-way and
runs only when requested; it does not change the LifeOS workspace. A live tenant
connection still needs its own check.

The public demo can optionally collect a small set of usage events after a
visitor agrees. The [analytics guide](docs/analytics.md) explains setup and what
is sent. It stays off until the public build has valid identifiers configured;
the standalone workspace does not load analytics.

For a browser-only build or hosting the fictional demo, see
[HOSTED_DEMO.md](HOSTED_DEMO.md). These options are separate from the private
LifeOS service and include no private credentials or records.

There is also an [optional AWS hosting guide](docs/deploy-aws.md) for the
browser-only demo. It prepares the infrastructure and tagged releases for a
separate host; it has not been deployed or checked against a live AWS account.
Running it needs an AWS account and can incur charges. The usual public demo
continues to use Cloudflare.

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
