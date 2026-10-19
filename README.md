# LifeOS Open

An open-source personal workspace for scheduling, coursework, lecture notebooks and everyday records, with local SQLite and a browser-only fictional demo.

https://github.com/user-attachments/assets/f4bbea53-1975-498b-9fda-e891a588e5cd

## Overview

Daily planning spans calendar commitments, deadlines, source material and records
that need to stay useful after a reload. Lecture notes add another requirement:
handwriting, audio and slides need a common timeline rather than separate files.

LifeOS Open runs the browser interface and domain rules against a local Node
service. SQLite stores records and file bytes. The default workspace is authored
for Example User, with fictional courses and contacts such as John Doe; it needs
no external account. Optional assistant services use labelled demo replies until
an operator configures a compatible provider.

This personal project is the standalone open-source edition. It includes no
personal workspace or original private history. The demo video, fixtures and included
[screenshots](docs/screenshots/today.png) use fictional or synthetic content.
See the [screen inventory](docs/features.md) and
[route inventory](docs/api-routes.json) for the retained surface.

## Public browser demo

Try the [interactive demo](https://lifeos.jacklai.ca) without signing in.
It uses the same fictional application in this repository. Changes and uploaded
files stay in that browser's IndexedDB/local cache; the public host has no
application API, visitor database or model credentials. Clearing site data or
browser eviction can remove those local edits. There is no cross-device sync.

The demo's gray chat composer is read-only. Click an authored question to send
it and see its example response. The schedule examples apply their own local
change and provide Undo. These replies are scripted; they do not demonstrate
arbitrary AI analysis, real email delivery or connected personal accounts.

- [Browser engine](src/browser/service.mjs): SQLite WASM and local job adapters.
- [Static host](src/hosted/worker.ts): public assets, no server-side workspace API.
- [Asset builder](tools/build-hosted-assets.mjs) and
  [deployment template](wrangler.public.example.jsonc): separate demo/parent origins.
- [Public frame](src/hosted/public-entry.mjs): the centered Demo banner, source
  link, login control and sandboxed frame used on the public website. This is
  presentation only. The website's personal authentication and private backend
  are separate and are not included in this repository. An integrating host
  selects this frame only for anonymous root requests after its own session check.

The default `npm run dev` mode still runs the standalone Node/SQLite workspace.
For a browser-only build, install its pinned build dependencies automatically
with `node tools/build-browser-demo.mjs`; then configure the example hosting
origins and build assets with `node tools/build-hosted-assets.mjs`.
No private account credentials are needed for either demo mode.

See the [October 22 audit](docs/demo-audit-2026-10-22.md) for the checked paths
and explicit limits. Demo changes include training-plan fixtures, whole-list
priority ranking, optional Devotional/Prayer routines, pen-first live notes,
reachable effort controls, local-save repairs and the authored chat examples.

The Instrument interface uses self-hosted Barlow fonts and ten selectable themes
in Settings. Theme choices persist with workspace settings in both local and
browser-only editions.

## How it works

1. **Serve a loopback workspace.** [`src/local/main.ts`](src/local/main.ts)
   binds to `127.0.0.1`, checks the request host and delegates requests to
   [`src/local/service.ts`](src/local/service.ts). The service supplies local
   storage/file adapters to the existing [`src/cloud/app.mjs`](src/cloud/app.mjs)
   routes. Local mutations are serialised so asynchronous read/plan/write steps
   cannot interleave within this service instance.
2. **Persist records and files.**
   [`src/local/database.ts`](src/local/database.ts) adapts Node's SQLite API to
   the D1-shaped interface used by the routes. Batches use `BEGIN IMMEDIATE`
   with rollback on failure; the file database uses WAL and foreign keys.
   [`src/local/objects.ts`](src/local/objects.ts) implements local file storage.
   [`src/cloud/store.mjs`](src/cloud/store.mjs) manages versioned records,
   mutation receipts and audit history. Version checks expose conflicting edits.
3. **Seed a fictional workspace.**
   [`src/local/workspace.ts`](src/local/workspace.ts) expands
   [`demo/scenarios.mjs`](demo/scenarios.mjs) into schedules, coursework, notes,
   finance and other records. Dates are positioned relative to first launch.
   Existing databases are neither cleared nor silently reseeded.
4. **Plan from saved commitments.** [`src/domain/today.mjs`](src/domain/today.mjs)
   combines the day's state. [`src/domain/school.mjs`](src/domain/school.mjs)
   ranks ready academic tasks using due-date urgency, capacity risk, review age
   and difficulty, separating blocked tasks. These are deterministic rules, not
   a learned priority model. [`src/domain/planning-insights.mjs`](src/domain/planning-insights.mjs)
   derives capacity warnings and latest-start guidance from saved work windows.
5. **Keep browser edits recoverable.** [`public/storage.js`](public/storage.js)
   and [`public/lecture-storage.js`](public/lecture-storage.js) retain local
   drafts and notebook state. [`public/lecture-edit-store.js`](public/lecture-edit-store.js)
   and [`public/lecture-ink-journal.js`](public/lecture-ink-journal.js) support
   durable notebook edits; [`public/recorder.js`](public/recorder.js) manages
   recording. Timed ink/audio support replay; the bundled transcript is authored,
   rather than recognised from arbitrary new speech.
6. **Run local jobs or configured chat.**
   [`src/local/services.ts`](src/local/services.ts) drains up to 20 eligible queued jobs
   after successful writes, without a separate daemon. Default assistant replies
   use saved fictional context. [`src/shared/llm.mjs`](src/shared/llm.mjs) implements
   the optional compatible chat transport. Selected images and saved context can
   leave the machine when real-provider mode is enabled.
7. **Export and restore.** [`src/local/backup.ts`](src/local/backup.ts) creates
   backups with file checksums and readback verification.
   [`tools/restore.mjs`](tools/restore.mjs) restores to a new database and checks
   structure, file bytes and equality. Sessions and worker credentials are omitted.

## Design decisions and trade-offs

- Reusing the route contracts retains validation and domain behaviour across the
  standalone and hosted paths. It also leaves deployment-oriented modules that
  need infrastructure beyond the local app.
- SQLite makes records and file bytes inspectable in one local installation.
  Synchronous database work and serial mutations limit concurrent throughput;
  this service is intended for a personal workspace.
- Device drafts and queues protect already-open work through disconnection.
  They do not provide a complete offline app shell or offline cold startup.
- Default demo services make the app usable without credentials. Their answers,
  transcripts and refresh outcomes do not establish live-service quality.
- Backups include private records and file bytes. Verification improves restore
  confidence, but exports need the same care as the workspace itself.

## Results and evaluation

Reproducible here: `npm test` runs unit/API regression tests against fictional
fixtures, local persistence and controlled services. Browser-engine integration
tests run separately with `node --test src/browser/browser-service.test.mjs`
after `node tools/build-browser-demo.mjs --test-bundle`. Run the command after
`npm ci`; no credentials are required.

The end-to-end command, `npm run test:e2e`, has 50 cases: the 21 workflows shown in the demo video,
each at 1440 × 900 and 390 × 844, plus navigation, cold-start and Instrument interaction coverage at
each size. The Instrument port passed all 50 cases, including affected reruns, along with
49/49 built-app smoke checks. These counts describe synthetic functional
coverage, not a reliability rate or measured personal-productivity gain.
The tests and commands are described below; live providers were not certified.

Headline behaviours have direct regression coverage:

| Behaviour | Evidence |
| --- | --- |
| Schedule changes, conflicts and priority order | [02-schedule](test/e2e/02-schedule.spec.mjs), [03-overlap](test/e2e/03-overlap.spec.mjs), [05-priority](test/e2e/05-priority.spec.mjs) |
| Ink persistence, recording and timed replay | [07-notebook](test/e2e/07-notebook.spec.mjs), [08-recording](test/e2e/08-recording.spec.mjs), [09-timed-replay](test/e2e/09-timed-replay.spec.mjs) |
| Saved context reaches assistant adapters | [provider regressions](test/provider-neutral.test.mjs), [11-tutor](test/e2e/11-tutor.spec.mjs), [12-advisor](test/e2e/12-advisor.spec.mjs) |
| Queued edits survive a disconnect and reconnect | [18-offline](test/e2e/18-offline.spec.mjs) |
| Photo replacement/history and journal revisions | [19-photo](test/e2e/19-photo.spec.mjs), [20-journal](test/e2e/20-journal.spec.mjs) |
| Backup restore and local API persistence | [local tests](test/local.test.mjs), [review regressions](test/review-regressions.test.mjs) |

## Getting started

Install Node.js 24 or newer with npm. Fresh-copy verification used Node 24.19.0 and npm 12.2.0.
Run these commands from the repository root:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:8787`. The server prints `LifeOS standalone`, its loopback
URL and PID. First launch creates `.local/workspace.sqlite` and seeds the
fictional workspace, including an upcoming lab and a sample lecture with timed
ink, spoken audio and slides. No `.env` or API key is needed. Stop with Ctrl-C.

The server accepts `PORT` and `LIFEOS_DATABASE` environment overrides. To use a
repeatable advancing demo clock with a new fictional database:

```sh
DEMO_CLOCK=2026-10-19T10:35:00Z LIFEOS_DATABASE=.local/clock-demo.sqlite npm run dev
```

The clock advances while the process runs. The flag does not reset an existing
database. For the bundled production entry point:

```sh
npm run build
npm start
```

This builds `build/server.mjs` and starts the same loopback workspace. Stop any
development instance first if both use the same port. Settings can create and
download a verified backup; to restore that downloaded file to a new path:

```sh
npm run restore -- backup.json .local/restored.sqlite
```

The command refuses to overwrite an existing database. Set `LIFEOS_DATABASE` to
the restored path before the next start. `backup.json` is an operator-created
export, not a bundled fixture.

### Configuration

The defaults are for local exploration. Configuration names and placeholders
are documented in [`.env.example`](.env.example); `.env` is optional and ignored.

| Setting | Default | Effect |
| --- | --- | --- |
| `PORT` | `8787` | Loopback port |
| `LIFEOS_DATABASE` | `.local/workspace.sqlite` | SQLite path |
| `DEMO_SEED` | `true` | Seed only a new database |
| `AUTH_MODE` | `demo` | Demo, token-protected `local`, or Google OAuth |
| `LOCAL_ACCESS_TOKEN` | unset | Local mode requires at least 24 characters |
| `LLM_MODE` | `mock` | `real` enables configured chat requests |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | unset | Compatible provider connection |
| `LLM_MODELS` | unset | Additional comma-separated model choices |
| `GOOGLE_MODE` | `local` | `real` opts into configured Google file operations |

For an empty workspace use a new database path, `DEMO_SEED=false`,
`AUTH_MODE=local` and your own token. Existing data requires an intentional
migration when changing ownership. Real Google/OAuth, school origins and retained
workers need operator-owned resources; they are not required by the demo.

## Testing

After installing dependencies:

```sh
npm test
npm run build
npm run lint
npm run typecheck
npm run privacy
npx playwright install chromium
npm run test:smoke
npm run test:e2e
```

- Unit/API tests: 147 cases in [`test/`](test/), covering local persistence,
  authentication, revisions, backup/restore, provider context and configuration.
- E2E: 50 cases in [`test/e2e/`](test/e2e/), using fictional databases, fake
  microphone input and a loopback provider stub. Tests assert visible results
  and persistence, and reject console/page errors or failed same-origin requests.
- Smoke: 49 checks driven by [`tools/smoke.mjs`](tools/smoke.mjs) against the
  built entry, including navigation and representative interactions.
- [`tools/privacy.mjs`](tools/privacy.mjs) scans publishable source for private
  identifiers and secrets, reporting locations without values. Vendor attribution
  is reported separately. Operator-specific patterns may be supplied externally.

Browser suites own isolated Chromium contexts and disposable loopback servers,
closing them in `finally`. They use no personal browser profile. To reuse an
installed test runtime, set `PLAYWRIGHT_EXECUTABLE_PATH` or
`PLAYWRIGHT_BROWSERS_PATH`. Evidence goes into ignored `.runtime/` directories.
TypeScript checks the local adapters strictly; inherited JavaScript receives
syntax/control-flow linting and functional tests.

## Project structure

```text
public/                      browser ESM interface, notebook and vendored libraries
src/domain/                  deterministic planning and personal-workspace rules
src/cloud/                   API routes, validation, versions and audit history
src/local/                   Node service, SQLite/files, seed and backup adapters
src/shared/                  shared contracts and compatible chat transport
src/integrations/, src/runtime/  retained configured-deployment paths
demo/                       authored fictional scenarios
test/                       unit/API tests and end-to-end specs
tools/                      build, privacy, restore and browser harnesses
docs/                       screen/route inventories and fictional screenshots
THIRD_PARTY_NOTICES.md        dependency and bundled-asset terms
```

## Limitations and known issues

- Full startup or reload while offline is unsupported. Already-open editors and
  durable queues retain work; reconnect to synchronise before reloading the app.
- Demo transcription and handwriting interpretation are authored examples.
  Recording bytes/timing save, but automatic recognition of arbitrary new audio
  or ink needs additional services. No recognition-quality claim is made.
- The default model picker offers Demo AI (offline). Compatible chat providers
  receive configured context/images, but their live quality and account behaviour
  were not tested. Compatible endpoints do not supply account quota data.
- Live email sending is unimplemented; local draft composition/export is available.
  School collection, push delivery, phone arrival automations and native workers
  require additional configured infrastructure.
- Local maintenance stores a report. Automatic code editing and deployment are
  unavailable with the standalone chat-only setup.
- External service links require configured origins. Local source documents stay
  available. Browser microphone permission is required for new recordings.
- Demo authentication is for loopback exploration. A hosted/multi-user deployment
  requires its own configuration and operational validation.

## License

MIT; see [`LICENSE`](LICENSE). Bundled libraries/assets and dependencies retain
their own terms, including web-push's MPL-2.0 file-level obligations. They are
listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), with synthetic
media provenance in [`ASSET_PROVENANCE.md`](ASSET_PROVENANCE.md).
