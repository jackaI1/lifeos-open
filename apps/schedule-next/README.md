# Schedule page (Next.js)

I built a small Next.js page that shows today's events and my open deadlines because I wanted
my planner available in a second front end. The page only reads my data. It never changes a
task or an event.

## What the endpoint returns

The page reads LifeOS's schedule through a GraphQL endpoint (a query API where the caller picks
the fields it wants). The endpoint runs on my machine at `/graphql`, started with
`npm run graphql:schedule` in the repository root. Each request is a POST with a JSON body and a
bearer token, a password sent in the `authorization` header.

Two queries are available:

- `day(date: "2026-11-16")` returns the day's `date`, its `timeZone`, its `events` (`id`,
  `title`, `start`, `end`, `location`) and its `deadlines`. Leave out `date` for today.
- `deadlines(withinDays: 14)` returns open tasks due within that many days, overdue ones first.
  The number must be from 1 to 60.

Example request body:

```json
{"query": "{ day { date events { title start end } } deadlines(withinDays: 7) { title due overdue } }"}
```

The endpoint refuses a query that is longer than 2,000 bytes, nests more than four levels deep,
selects more than 40 fields, or tries to write anything. A bad date such as `2026-02-31` gets a
clear error message.

## How the page works

The first version of the page is rendered on the server, so the schedule is already there when
the page arrives. The server reads the token from an environment variable, and it never reaches
the browser. The Refresh button calls `/api/schedule`, a route on this same app that asks the
endpoint again and returns the result. If the refresh fails, the old schedule stays on screen and
a message says why.

The app checks the endpoint's reply with a schema (zod, a runtime checker for data shapes) before
it shows anything. A reply in the wrong shape produces an error message, not a broken page.

## Run it

Start the GraphQL endpoint from the repository root with a copy of the workspace file, then start
this page:

```sh
LIFEOS_GRAPHQL_DATABASE=/path/to/copy.sqlite LIFEOS_GRAPHQL_TOKEN=replace-with-a-long-random-token npm run graphql:schedule
cd apps/schedule-next
npm ci
SCHEDULE_GRAPHQL_TOKEN=replace-with-a-long-random-token npm run dev
```

Open http://localhost:3100. The token must be the same in both commands.

## Files and checks

- `lib/graphql.ts`: the query text, the schema check and the server-side request.
- `app/page.tsx`: the server-rendered first load.
- `app/api/schedule/route.ts`: the refresh route that keeps the token on the server.
- `components/ScheduleView.tsx`: the page's events, deadlines and Refresh button.
- `test/`: tests for the request, the reply checks, and the component's states.

`npm test`, `npm run lint`, `npm run typecheck` and `npm run build` run in the "Schedule apps"
GitHub Actions workflow. The GraphQL schema and resolver tests run with the root test suite.
