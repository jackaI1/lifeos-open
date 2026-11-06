# Companion design notes

## Public API

I chose a separate public demonstration feed because the LifeOS browser demo
runs its routes inside a browser worker. Those routes are not a remote schedule
API. I can test the phone view and its saved copy without connecting private
LifeOS data or implying that browser edits synchronize with this app.

`demo-api/today.json` is the public companion demo API. It is served over HTTPS by GitHub's raw file host at the URL in `DemoHTTP.endpoint`. It requires no token and accepts only reads. This is a separately published companion feed, not the browser demo's internal routes or a private LifeOS endpoint.

Version 1 has `schemaVersion`, an IANA `timeZone`, `schedule` and `deadlines`. Events contain an ID, title, location, day offset, start and end in 24-hour HH:mm format. Deadlines contain an ID, title, course, day offset, due time and completion state. Offsets are calendar days relative to the day a successful response is processed in the feed timezone. They allow a static public demonstration to remain useful on any day. All content is invented. `Tests/LifeOSCoreTests/Fixtures/today.json` mirrors the published response for deterministic testing.

The decoder rejects unsupported versions, unknown timezones, duplicate IDs within a list, blank IDs/titles, invalid times, reversed event ranges, offsets outside -7 through 30, and excessive list or response sizes. Cross-midnight events are outside this version's contract. Daylight-saving calculations use Calendar, not 86,400-second increments. Nonexistent wall-clock times are rejected; repeated times use Calendar's first occurrence.

## Storage and refresh

A successful download resolves relative examples to absolute dates and records `fetchedAt`. The app stores that snapshot in Application Support as `LifeOSCompanion/snapshot-v1.json`, using atomic replacement. Reopening the cache does not resolve the relative feed again. The schedule filters by the actual current day in the feed timezone, while unfinished overdue deadlines stay visible. The UI reevaluates each minute and refreshes when the app returns to the foreground.

The observable, main-actor `CompanionStore` restores disk data before starting a download. Its states distinguish saved, fresh, unavailable, failed refresh and failed persistence. It ignores overlapping refresh requests, checks cancellation before committing data, and preserves the last successful disk copy on download or decoding errors. A 15-second request timeout bounds ordinary connectivity failures. HTTP status and a 1 MiB response limit are checked before decoding; URLSession still buffers the response before the size check, so this is not a streaming memory limit.

The clock and transport are injected in tests. File tests use real temporary directories and remove them afterwards. Only the external network boundary is replaced. The app uses system text, Dynamic Type and semantic colors, with no fixed row heights; freshness is communicated through text as well as an icon.

## Build

`Package.swift` builds the Foundation/Observation core without an iOS SDK. XCTest requires full Xcode on macOS; Apple's standalone Command Line Tools do not ship XCTest. `project.yml` describes an iOS app, core framework and unit test bundle using the same source files. XcodeGen's generated project is disposable and excluded from git.

`.github/workflows/ios.yml` runs on `macos-15`, executes `swift test`, then generates the Xcode project and runs XCTest on an explicitly owned iPhone simulator. It also builds the app for a generic iOS simulator with code signing disabled, installs and launches it, and saves a screen image for visual review. The public endpoint first appears on main when the initial PR merges, so that first PR screen shows the honest unavailable state; the merged-main run can display the live examples. The simulator is shut down, deleted and its removal checked on exit, including failure paths. No local development server is needed.

The original repository contained a README only, so there was no earlier application or test suite to preserve. Live-device signing and App Store distribution are outside this demonstration. A separate `LifeOSDemoCheck` command also reads the real HTTPS feed, persists it, and checks an offline reopen using the same core. Simulator CI proves the iOS code compiles, launches and the shared behavior executes; it does not prove physical-device usability or synchronization with LifeOS.
