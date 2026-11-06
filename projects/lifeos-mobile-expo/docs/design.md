# Why I built the agenda this way

I wanted a quick view of my schedule and unfinished deadlines between classes, including when my connection dropped. I used one native screen so I can read the day without navigating through the full LifeOS workspace.

## Public examples

LifeOS Open's hosted demo keeps each visitor's workspace in their browser. Its API runs in a browser worker, so the phone cannot call it remotely. I published a separate read-only feed using its fictional event and task names. A WebView would keep the browser's storage behavior; React Native lets this app use native refresh controls and device storage directly.

This app does not connect to private LifeOS or synchronize browser-demo edits. The public feed is an example agenda that anyone can open without credentials.

## Dates that stay meaningful offline

On a successful fetch, I resolve relative calendar days into fixed event timestamps and deadline dates. I save those dates with the fetch time. Reading the saved copy never recalculates its offsets, so yesterday's events do not appear to happen today while offline.

Today follows the device's local calendar. Date-only deadlines stay calendar dates, missing deadlines stay unknown, and unfinished overdue tasks remain visible. At midnight and on return from the background, the screen recalculates which saved events overlap today. It fetches a fresh copy on return to the foreground.

## Screen layout

I put event times in a left column and activities and locations beside them, like a departure board. Deadlines follow as a separate list with a due label, course and next step. This keeps the important information aligned without enclosing every item in a card.

The light background supports daytime reading. Blue marks actions and confirmed times; brown marks overdue or unconfirmed dates. Text labels explain these states without relying on color alone. Content stays centered on tablets, scrolls within the screen's safe area and follows the device's font-size setting. Refresh and Retry have at least 48-point touch targets.

## Recovery and limits

The validator checks the complete response before replacing the saved copy. It rejects unsupported versions, duplicate IDs, impossible dates and invalid event ranges. A failed request leaves the old snapshot intact. A storage failure still shows the fresh agenda, with a warning that it could not be saved. Requests run one at a time, have a ten-second timeout and cancel when the screen unmounts.

The tests cover calendar boundaries, daylight saving, overnight events, unknown deadlines, completion filtering, cache restoration, malformed responses, refresh, retry and storage failure. CI also exports native bundles for both phone platforms and a web preview.

First use offline has no saved copy to show. Expo Go may need the computer's development bundle on a cold reload; a production installed build would remove that dependency. I verified bundle exports and the browser preview here, but did not run this version on a physical phone or native simulator.
