# My optional study desk

I built a schedule and report planner because keeping my schedule, coursework
and lecture notes in separate places made it hard to plan my day. This optional
view of LifeOS puts a fictional day, its deadlines and a report plan together.
It can also quote public instructions and compare simulated lab runs.

I keep the account and publishing services here to learn how repeated requests
and queued work behave. They use fictional records. The normal LifeOS workspace
and its private notes are separate from these examples.

## Read the day and plan a report

```sh
npm ci --prefix apps/today
npm run dev --prefix apps/today
```

At <http://localhost:3000>, **Today** uses `public/demo/today.json`. The Next.js
App Router renders the first schedule on the server. Refresh calls `GET /api/feed`;
the route returns a typed view or a 503 response. The reader uses
`src/shared/today.ts` for validation, day shifting and selection. A day begins at
5 am in Toronto, and date-only deadlines stay calendar dates. No private database
is read. A missing feed shows an error and a refresh button; empty sections say so.
Native links jump to focusable sections, and all controls have visible focus.

**Report plan** starts with a fictional report. Expand **Edit tasks and
dependencies** to change the JSON. A task has an `id`, `title`, whole-day
`duration`, `dependsOn` IDs and optional `deadline` in YYYY-MM-DD form. The first
pass walks dependencies to find the earliest start. A reverse pass finds the
latest start that preserves the finish and each deadline. Their difference is
slack, the spare time available. Red bars have zero or negative slack; the table
also names overdue tasks and deadlines the plan misses. CSV dates include the
last working calendar day. Cycles, missing tasks, duplicate IDs and invalid dates
are rejected. This is a calendar-day planner, without holidays or resource limits.

## Ask the public guide

On a Linux development machine with Docker, or a GitHub Codespace:

```sh
docker compose -f compose.study.yaml up -d --wait vectors
export CONSOLE_DATABASE_URL=postgresql://study:fictional-study@127.0.0.1:5433/study
npm run seed --prefix apps/today
npm run evaluate --prefix apps/today
npm run dev --prefix apps/today
```

Open **Public guide** and ask “When does the LifeOS day start?” Follow a numbered
source to see the exact stored passage. The UI shows loading, unavailable and
insufficient-evidence states. tRPC shares TypeScript API types between the route
handler and browser. TanStack Query keeps a completed answer for a minute, with
an explicit repeat question triggering a fresh read.

Postgres stores eight passages from `docs/public-guide/` in pgvector, an extension
that compares lists of numbers. I use 128 normalized word-hash features as small,
deterministic embeddings. The SQL cosine-distance operator does the actual
ranking. This baseline recognizes shared words, not meaning or paraphrases.
A 0.24 similarity cutoff withholds weak results. This corpus is deliberately small;
I do not claim general search accuracy.

The default answer streams exact passage quotations with numbered citations.
For a language model that chooses shorter quotes, set `ANSWER_MODEL_URL` to an
OpenAI-compatible `/v1/chat/completions` endpoint, `ANSWER_MODEL` to its model name,
and optionally `ANSWER_MODEL_KEY`. A local server at `http://127.0.0.1:PORT` works;
remote endpoints need HTTPS. This sends the question and public passages to that
provider. SSE, or server-sent events, brings model text back in chunks. Every
completed line must be an exact passage quote followed by its valid citation.
Unsupported lines are withheld and an uncertain state appears. This checks quote
support, not whether the quote fully answers the question. Live paid model use is
not part of CI; the streaming adapter is tested with controlled transport chunks.

`npm run evaluate --prefix apps/today` scores nine fixed questions in
`test/eval-questions.json`: eight supported questions and an unknown one.
Retrieval hit means the expected passage appears in the top three; grounding
requires exact quoted text and valid source numbers, or abstention for the unknown.
The command exits unsuccessfully on a regression. CI saves the per-question report.
To change the corpus, edit those public Markdown files, seed again, then compare
the same report. The seed replaces the passage set in one transaction.

## Publish public instructions

The publisher clones a configured Git repository, validates every document, then
publishes a complete HTML snapshot. Redis holds queued work and transformed-page
cache entries. RQ, the Python worker, retries a failed job twice. SQLite holds
published pages and build status. Use one worker for this small publisher.

```sh
docker compose -f compose.study.yaml up -d --build redis publisher worker
curl -X POST http://127.0.0.1:8001/builds \
  -H 'Authorization: Bearer fictional-publisher' \
  -H 'Content-Type: application/json' -d '{"key":"guide-v1"}'
# Copy the returned ID:
curl http://127.0.0.1:8001/builds/BUILD_ID
curl 'http://127.0.0.1:8001/search?q=backup'
curl http://127.0.0.1:8001/pages/backup.md
curl http://127.0.0.1:8001/metrics
```

The default source is this public repository and `docs/public-guide`. Set
`PUBLISH_GIT_SOURCE` and `PUBLISH_DOCS_PATH` in the worker configuration to use a
different public repository. They are operator settings, not arbitrary API inputs.
Change the fictional publisher token before sharing access. This is a local
service, without production user accounts or a public ingress.

Each `.md` or `.mdx` page needs YAML front matter with a nonempty `title` and
`description`. Markdown links to local files and headings must resolve inside
the document tree. Code fences must close and name a supported language.
MDX uses its Markdown subset: executable JSX and imports are rejected. Raw HTML
is disabled and the rendered output is sanitized. External link schemes are
checked, but remote servers are not contacted to test availability.

A SHA-256 content hash and transform version identify cached HTML. Editing a page
invalidates its cache entry; unchanged content can be reused. Only after all
validation succeeds does a transaction replace the visible page set, including
deleted pages. Repeating a build key returns its status and does not enqueue a
second job, including after a failed attempt. After exhausted retries, I use a new
build key to request another build. Re-running a worker after interruption replaces the snapshot
without duplicate pages. A new build key reads the source repository's current
HEAD. Logs emit JSON events with build duration and cache hits. `/metrics` reports
queue depth, successful publication attempts and the cache hit rate. A successful
retry counts as another publication attempt.

For development without containers:

```sh
uv sync --frozen --directory services/study --python 3.12
# Start a separate Redis service first; set PUBLISH_REDIS_URL if needed.
export PUBLISH_GIT_SOURCE=https://github.com/jackaI1/lifeos-open.git
cd services/study
uv run uvicorn api:app --host 127.0.0.1 --port 8001
# In another terminal with the same environment:
uv run rq worker --url redis://127.0.0.1:6380/0 --with-scheduler lifeos-docs
```

## Compare simulated pick runs

```sh
uv sync --frozen --directory services/study --python 3.12
cd services/study
uv run flask --app 'robot:create_app()' run --host 127.0.0.1 --port 5001
```

Keep the Next.js app running, then open **Pick trials**. Run the starting values,
change the gripper tolerance and run again. Select two saved runs to compare the
success rates and failure counts. The Next.js `/api/picks` proxy calls Flask on
localhost; `PICK_API_URL` can point to another trusted service address.

The model samples two independent Gaussian camera errors, in millimetres, then
checks the radial error against half the part size and the gripper tolerance.
It labels failures outside the camera window or due to gripper misalignment.
A fixed seed repeats the same trial errors so changes can be compared. SQLite
persists up to the most recent 100 runs shown by the list endpoint. This does not
model motion, force, calibration or a real robot's success probability.

The Flask endpoints are `POST /runs` (configuration), `GET /runs`,
`GET /runs/{id}`, `GET /compare?ids=1,2`, and `GET /healthz`. The POST object has
`part_size_mm`, `camera_noise_mm`, `gripper_tolerance_mm`, `trials` and `seed`.
To add a scenario, add an explicit validated parameter in `robot.py`, update the
proxy schema and form, and add a seeded test with a known limiting case, such as
zero camera noise. Keep each failure category distinct so their counts sum to
failed trials. `PICK_DATABASE` chooses the local database path.

## Try fictional account requests

The [ledger and payments guide](study-accounts.md) explains the Go settlement
service, Lambda payment simulation and GraphQL comparison. They use invented
accounts and amounts, and never connect to a bank or move money.

## Checks and cleanup

```sh
npm run lint --prefix apps/today
npm run typecheck --prefix apps/today
npm test --prefix apps/today
npm run build --prefix apps/today
uv run --directory services/study ruff check . --output-format concise
uv run --directory services/study pytest -q
```

The Next.js workflow runs component tests, the real pgvector evaluation and five
browser journeys, including SSR, keyboard links, CSV export, Flask and tRPC.
The study-services workflow runs real Redis/RQ publishing, PostgreSQL ledger
concurrency tests and LocalStack payments. Container work runs on GitHub's Linux
runners. The original LifeOS CI continues to run alongside these checks.

Stop development servers with Ctrl-C. `docker compose -f compose.study.yaml
--profile payments down` removes service containers and keeps their data. Add
`--volumes` only to discard these fictional databases. No normal LifeOS database
is mounted. Delete local `.venv`, `node_modules`, `.next`, `dist`, test reports and
SQLite fixtures when finished with a disposable checkout.
