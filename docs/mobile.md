# Checking my day on a phone

I built a small phone view because I wanted the schedule and deadlines together
when I was away from my computer. It reads the same fictional examples as the
public LifeOS demo. It does not connect to my personal workspace or copy edits
from a browser.

## Try it

Install Node.js 24 or newer. From a fresh checkout:

```sh
cd mobile
npm ci
npm start
```

Install Expo Go on an Android or iOS phone and scan the terminal's QR code, with
the computer and phone on the same Wi-Fi. Expo is the toolkit that packages the
React Native interface for phones. A compatible Android emulator or iOS simulator
can also open the app with `a` or `i`. Physical iOS devices may require signing
Expo CLI and Expo Go into the same free Expo account with `npx expo login`.
See [Expo's startup guide](https://docs.expo.dev/get-started/start-developing/).
No LifeOS account or API key is needed.

For a browser preview, run `npm run web` instead. Stop either server with Ctrl-C.
The browser preview uses browser storage; it does not install an offline website.

## Read the day and try a lost connection

The screen shows the schedule first, then overdue deadlines and the next seven
days. Deadlines with no date appear under **Date to confirm**. A date without a
time says **Time not supplied**, rather than inventing a midnight deadline.
Times use Toronto time and the LifeOS day begins at 5 a.m.

1. Open the app online and wait for **Saved for offline use**.
2. Put the phone in airplane mode, leaving Wi-Fi off, and press **Refresh**.
   The saved events and tasks stay visible with **Could not refresh** and the
   last download time.
3. Reopen an already installed build offline to read its saved snapshot. Expo Go
   development previews may need the development server to reload JavaScript;
   that limitation is separate from the saved data.
4. Reconnect and press **Retry**, or pull down on the list. The downloaded copy
   replaces the old one. Returning to the foreground also checks for updates.

On a first launch without a connection there is no saved day. The screen says
so and offers **Retry**. A failed disk save keeps the fresh schedule visible but
warns that it will not survive closing the app. Clearing app storage removes
the snapshot. It is ordinary device storage, not encrypted storage for private
records.

## Where the examples come from

`tools/build-demo-feed.ts` copies an explicit list of fields from the authored
records in `demo/scenarios.mjs` into `public/demo/today.json`. It never opens a
workspace database. The normal root build regenerates this file. The client
downloads it from the public repository's `main` branch over HTTPS:

<https://raw.githubusercontent.com/jackaI1/lifeos-open/main/public/demo/today.json>

On a successful download, the sample's reference date moves to the current
LifeOS day. Clock times stay in Toronto time, including daylight-saving changes.
If a sample lands on a nonexistent spring-forward time, resolution fails and
the saved copy stays intact. Repeated fall-back times choose the earlier time.
Saved snapshots contain resolved dates and never move forward just because the
phone's date changes. An older copy is labelled with its original date, and its
past deadlines become overdue. A timer updates the visible day at 5 a.m.; it
also tries a fresh download. The offline copy is a snapshot, not a live schedule.

For public fixture development only, set `EXPO_PUBLIC_DEMO_FEED_URL` before
starting Expo. It is embedded in the app, so I never put a secret or private feed
there. The cache key includes that URL to keep different fixtures separate.

## How the client is put together

- `src/shared/today.ts` owns the feed types, validation, date resolution and
  Today selection. The web workload model imports its `deadlineDay` function.
  Both use the existing calendar utilities and 5 a.m. LifeOS day rule.
- `mobile/src/feed.ts` checks the network response and cached JSON, then stores
  the resolved snapshot in AsyncStorage, the phone's persistent key-value store.
  The request times out after ten seconds and cancels when the screen closes.
- `mobile/src/useToday.ts` loads the saved copy while a fresh request runs,
  prevents overlapping retries, and removes its timer and foreground listener
  when the screen closes.
- `mobile/src/TodayScreen.tsx` uses native scrolling, safe areas, scalable text,
  labelled headings and buttons, and pull-to-refresh. The layout caps its width
  on larger screens.

The mobile folder has its own dependency lock because Expo requires a specific
React version. Metro, the phone bundler, reads the shared sources but resolves
libraries only from `mobile/node_modules` to avoid mixing that React version
with the web app's version.

## Checks

From the repository root:

```sh
npm ci
node --test test/mobile-today.test.mjs
cd mobile
npm ci
npm run typecheck
npm test
npm run export
cd ..
npx playwright install chromium
node --test tools/mobile-browser.test.mjs
```

The six shared-model checks cover deadlines, DST, day boundaries, stale dates,
invalid input and the generated public examples. Jest and React Native Testing
Library exercise the native screen, network/cache failures, restart, retry and
resource cleanup. The browser walkthrough runs the actual exported app at phone
and tablet widths, closes its page, then opens a new page using the saved copy
while the feed is unreachable. It checks first-launch failure and recovery too.
It closes its isolated browser and temporary static server in `finally` and
records ownership and cleanup in `.runtime/react-native/`.

`.github/workflows/mobile.yml` runs type checks, Jest, all three platform exports,
the generated-feed check and that browser walkthrough. The existing web checks
still run in their own jobs. Exports prove JavaScript bundles build; they do not
prove an installed app ran on hardware. I have not tested a signed native build
or published an app-store release.
