# Public mobile feed

`public/lifeos-demo.json` is a read-only, fictional feed served from GitHub's raw main-branch URL. It needs no service account. Its event names, locations, task names, course codes and next steps come from the authored public examples in [LifeOS Open](https://github.com/jackaI1/lifeos-open/blob/main/demo/scenarios.mjs). The mobile feed deliberately does not claim to reflect visitor edits or private owner records.

## Version 1

The root has `version: 1`, a descriptive `source`, `schedule`, and `deadlines`. Each list accepts up to 1,000 entries with unique IDs within that list. Text is limited to 1,000 characters.

An event has `id`, `title`, `location`, `start`, and `end`. Each endpoint has an integer `dayOffset` between -365 and 365, and a 24-hour local `time` such as `10:45`. End must be after start. Nonexistent spring-forward times are rejected; ambiguous fall-back times use JavaScript's earlier occurrence.

A deadline has `id`, `title`, `course`, `nextStep`, boolean `done`, and `due`. `due` is either `{ "dayOffset": 2 }` or `null` for an unconfirmed deadline. Date-only deadlines remain calendar dates, not midnight UTC timestamps.

On a successful fetch, `resolveFeed` converts offsets against the device's current calendar date. Events become absolute ISO timestamps; deadlines become `YYYY-MM-DD` dates. The versioned snapshot also stores `fetchedAt` and `source`. Only validated snapshots are saved under `lifeos-public-snapshot-v1`. Reading the cache validates it again and never resolves offsets again.

A refresh fetches without a browser cache, aborts after ten seconds, validates the whole response and then replaces device storage. A failed request or invalid feed leaves the last saved snapshot intact. A failed storage write returns fresh data with a visible warning. The screen serializes requests, aborts on unmount, and refreshes on foreground. A one-shot midnight timer recalculates today's schedule without changing saved dates.

## Editing the example

Edit this JSON through a PR and run `npm test`, `npm run typecheck`, and `npm run lint`. The tests import the shipped file, so changing its shape or breaking its dates is checked against the same resolver the app uses. Keep all examples fictional. Never put a private URL, credential, calendar export, or personal deadline in the feed.

GitHub raw caching may delay propagation of edits. The app is intentionally read-only and does not provide authenticated synchronization. A production installed build would be needed for reliable cold startup without Expo Go's development bundle.
