# Demo companion design

The Android app mirrors the public iOS companion's read-only schedule and unfinished deadlines. It deliberately uses the iOS repository's public `demo-api/today.json` rather than a private LifeOS API. The web demo stores edits in the browser and does not publish them to this feed.

## Feed and calendar

The version 1 feed names an IANA time zone and gives events a `dayOffset`, `start` and `end`. Deadlines have `dayOffset`, `due` and `completed`. `DemoFeed.resolve` takes an explicit instant, finds the local date in the feed's zone, adds calendar days and resolves local times. It does not add multiples of 24 hours, which would be wrong across a daylight saving change. Spring gaps are rejected. An autumn overlap uses the first occurrence of a local time, matching the Swift companion. Events must end later on the same local day; overnight events need a future schema.

The parser requires version 1, a known zone, strict `HH:mm` times, offsets from -7 to 30, unique IDs per collection and nonblank IDs and titles. It limits each collection to 500 records and the response and snapshot to 1 MiB. Unknown JSON fields are tolerated for additive changes. Missing required fields and malformed JSON fail the whole refresh. Events and pending deadlines use time followed by ID as their stable sort order.

A snapshot contains epoch milliseconds and its original time zone and fetch instant, not relative day offsets. Reading the snapshot never resolves the original feed again. `eventsOn` and the stale-copy message use the feed's calendar day even if the phone is in a different zone. All visible dates, including last download, use that zone. Unfinished overdue deadlines remain visible.

## IO and state

`CompanionRepository` depends on `FeedSource`, `SnapshotStore` and a `Clock` so tests can control failures and time. Its synchronized operations run on Android's IO dispatcher. A ViewModel holds screen state across rotations, exposes a StateFlow (a stream containing the latest state), and prevents overlapping refresh taps. Initial startup loads the saved snapshot before attempting a fresh download. No repeating network refresh runs in the background.

The HTTP client uses a fixed HTTPS public URL by default, connect/read timeouts, no redirects, a 200-status requirement and a byte limit even for chunked responses. Its URL is injectable for loopback HTTP tests. The Android manifest blocks cleartext traffic and disables backup of its demo cache. No authentication or private endpoint is present.

`AtomicSnapshotStore` uses Android's AtomicFile `startWrite`, `finishWrite` and `failWrite`. AtomicFile stages bytes in a second file and commits the complete write; readers recover the previous complete file after an interrupted write. I read the committed bytes back before reporting success because AtomicFile can log some sync or rename failures without throwing an exception. One store and serialized repository operations are used in the app because AtomicFile itself does not provide cross-writer locking. An invalid or unreadable cache is treated as no saved copy, allowing a good download to repair it.

State distinguishes ready, saved, freshly downloaded and saved, offline with a previous copy, unavailable with no copy, and downloaded but not saved. A save failure still allows reading the new download in memory, with an explicit warning. A later failed network request preserves that warning's meaning: it never claims an unsaved in-memory copy was persisted. A failed refresh never overwrites the disk copy.

## Verification boundaries

The 38 JVM tests use the checked-in public feed fixture and local HTTP servers; they need no external network. Each HTTP server binds loopback on an automatically assigned port and stops in `finally`. The 13 instrumented tests include nine Compose screen tests and four tests using the actual Android AtomicFile implementation. The interrupted-write test leaves a staged file before opening a fresh store; it checks recovery of the previous complete bytes. These tests do not simulate every possible physical disk fault.

The optional `demoCheck` downloads the real feed and verifies a temporary atomic save and offline reopen. The local emulator script separately launches the production activity, confirms a successful download, force-stops it, disables the emulator's networks and verifies the saved schedule after a new launch. Neither live check is required for deterministic CI, since a public hosting outage should not break offline behavior tests.

The CI workflow runs both build and instrumentation jobs for PRs and main. The emulator action stops its emulator on exit. The local script records its exact PID, start time, serial and cleanup command, traps exit paths, and checks the process and console port after stopping it. It owns no browser pages and never stops unrelated emulators. This project has no instrumentation or collection of personal records.
