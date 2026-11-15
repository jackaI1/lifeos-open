# Weekly schedule (Vue 3)

I built a Vue 3 version of the public demo's weekly schedule because I wanted to see how the same
planner data reads in a second framework, with a clear answer for every state the page can be in.
The view shows Monday to Sunday of the current week, with each day's events and deadlines.

## What the page shows

- **Loading**: a short "Loading the week" status while the feed is fetched.
- **Ready**: seven days. Today is marked in words, a deadline before today is marked overdue, and
  a day with nothing on it says "Nothing planned."
- **Offline**: when the browser reports no connection, or the request cannot reach the server, the
  page says so and offers a Try again button.
- **Error**: when the server answers with an error, or the feed is in the wrong shape, the page
  says the schedule could not be read and offers the same button.

The data comes from the public demo feed, `public/demo/today.json` in this repository, which Vite
serves at `/today.json`. The feed is fictional.

## How it is built

- `src/composables/useWeekSchedule.ts` is a composable (a reusable function that holds state for a
  component). It loads the feed and sets one of the four states above. It takes the fetch function
  as an option, so tests can replace the network.
- `src/week.ts` turns the feed into seven days. It reuses the repository's feed parser and time
  helpers, the same ones the Today view uses.
- `src/components/WeekSchedule.vue` takes typed props (`days` and `timeZone`) and shows the week.
- `src/App.vue` connects the composable to the view and shows the status messages.

## Run it

```sh
cd apps/schedule-vue
npm ci
npm run dev        # http://localhost:3200
npm test           # Vitest component and composable tests
npm run typecheck  # vue-tsc
npm run lint
npm run build
```

The "Schedule apps" GitHub Actions workflow runs lint, the type check, the tests and the build on
every change to this folder.
