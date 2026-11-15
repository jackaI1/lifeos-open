# Vue week view

I built a Vue 3 version of my weekly schedule view because I wanted to see the
week in a second framework and check that my planner's rules work the same way
there. It reads the public fictional feed, shows seven days and tells me when it
cannot load the data.

## Try it

From the repository root:

```sh
npm ci --prefix apps/schedule-vue
npm run dev --prefix apps/schedule-vue
```

Open the address Vite prints. The page shows a loading message first, then the
week. Turn off the network, reload, and the page says it is offline and keeps the
last week that loaded. A failed request shows an alert with a **Try again** button.

## How it is put together

- `src/week.ts` turns the feed into seven local days, with overdue work listed
  separately and undated tasks counted. It does not touch the network or the clock
  except through the `now` value passed in.
- `src/composables/useWeekSchedule.ts` loads `/demo/today.json`, checks it with the
  shared `parseFeed` function, and moves between the loading, ready, offline and
  error states. The last good week stays in memory, not in storage.
- `src/components/WeeklySchedule.vue` takes typed props and shows the state. It has
  no network code.

`scripts/copy-feed.mjs` copies the public feed into `public/demo/` before a dev run,
build or test. That copy is git-ignored.

## Tests and checks

```sh
npm run typecheck --prefix apps/schedule-vue
npm run lint --prefix apps/schedule-vue
npm test --prefix apps/schedule-vue
npm run build --prefix apps/schedule-vue
```

The Vitest tests cover the week builder, the composable's states (including a
network failure and a feed that fails validation) and the component's display and
retry button. CI runs all four commands in `.github/workflows/schedule-vue.yml`.
