# LifeOS study desk

I built a small study desk because I wanted to try another way of reading my
LifeOS day and learn how a server can prepare a page before I open it.
It uses fictional schedule entries and public instructions, not my private notes.

From the repository root:

```sh
npm ci --prefix apps/today
npm run dev --prefix apps/today
```

Open <http://localhost:3000>. **Today** shows the schedule and deadlines;
**Refresh day** reloads the sample. **Report plan** lets me edit a fictional lab
report's tasks, see which delays affect the finish, and export a CSV.
The top links, forms and section links work with a keyboard.

**Public guide** needs the optional document database. **Pick trials** needs the
Python simulation service. The [study desk guide](../../docs/study-desk.md) has the
exact commands, endpoints, test setup and limitations for those tools.
This app is separate from the hosted browser demo and is not deployed there.

## How I arranged it

- `app/page.tsx` reads the public feed on the server. `app/api/feed/route.ts`
  reloads it using the same validation and Toronto day rules as the phone client.
- `components/` holds the schedule, plan, questions and pick-run forms. Each form
  has an explicit loading or error state and native keyboard controls.
- `lib/router.ts` defines the typed tRPC API, which keeps request and response
  types shared with the browser. TanStack Query caches completed question results.
- `lib/retrieval.ts` searches Postgres vectors and streams checked quote lines.
  `scripts/seed.ts` imports only `docs/public-guide/`; `scripts/evaluate.ts`
  compares nine fixed questions with their expected passages.
- `lib/gantt.ts` computes earliest and latest starts, slack and deadline warnings.
  `lib/accounts.ts` holds the separate, synthetic GraphQL accounts example.

## Checks

```sh
npm run lint --prefix apps/today
npm run typecheck --prefix apps/today
npm test --prefix apps/today
npm run build --prefix apps/today
uv sync --frozen --directory services/study --python 3.12
cd apps/today
npx playwright install chromium
npm run test:e2e
```

The browser runner starts one Next.js server and one Flask server, writes their
PID, start time, port and cleanup command, and stops both on completion or failure.
It also records the test browser process and verifies its exit. Its temporary
SQLite run history is removed. It uses a fresh browser context for
each test. The pgvector browser check runs when `CONSOLE_DATABASE_URL` is set.
