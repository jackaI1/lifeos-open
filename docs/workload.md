# Planning a week

I added this view because separate deadlines made it hard to notice a busy week
until I was already in it. In [the demo](https://lifeos.jacklai.ca/#school?workload),
I open **Academics → Week workload**. I use Previous week, Next week and This week
to compare nearby weeks. A bar shows saved calendar hours in green and the work
remaining on tasks due that day in blue hatching. Below it, a heat map shows
counts of outstanding deadlines for each course and day.

Hovering or using Tab shows the same tooltip. Clicking a mark, or pressing Enter
or Space, lists its tasks below the charts with links to their working pages.
Escape dismisses the tooltip. On a phone I can swipe each chart horizontally;
its labels keep their size and the rest of the page fits the screen. Keyboard
users can also focus the scroll region. Counts and hatching supplement colour.

## What the numbers mean

- Weeks run Monday to Sunday in the workspace timezone shown above the chart.
  Timestamp deadlines use that timezone; date-only deadlines keep their date.
- Remaining minutes take precedence over the original estimate, including zero.
  Missing or invalid estimates are flagged and contribute no invented hours.
- Completed, submitted, cancelled and archived tasks are excluded. Unknown dates
  and deadlines before the displayed week have their own review lists.
- Calendar hours use saved timed events, split at local midnight. Overlaps count
  once, including across the daylight-saving clock change. Cancelled events,
  date-only notices and invalid intervals do not add hours. Exclusions are counted.
- A deadline's work appears on its due day for comparison. It is not a claim that
  I should start that day. Study blocks can overlap task estimates, so adding
  the two is not a measure of available time or a scheduling guarantee.
- The view reads the same records as Today and Academics. It does not change
  them, infer missing dates, fetch an external calendar or upload chart data.

## How I built it

D3 is a library for turning data into graphics. I use its linear scale to turn
hours into bar widths, band scales to place days and courses in rows and columns,
and a quantized colour scale to group deadline counts into four shades. D3 also
draws the labelled axes and joins each day or cell to an SVG element, a shape
that stays clear when resized. The colour range is relative to the displayed
week; the printed counts are the exact values to compare between weeks.

`src/frontend/workload/model.mjs` is pure: it takes records, a date and a timezone
and returns a week model and geometry without touching the page, storage or
clock. It reuses the civil-date and interval helpers in `src/domain/time.mjs`.
`view.mjs` handles rendering, navigation, focus and task links. The build bundles
only the required D3 modules into `public/vendor/workload.mjs`; `@shell/ui.js`
resolves to the app's existing UI helpers. The Academics route loads this bundle
only when I open the workload view. `public/workload.css` uses the current theme.
No chart code comes from a remote script host.

## Checks

```sh
npm ci
npm test
npm run build
E2E_FOCUS='^28-' npm run test:e2e
```

Eight unit tests check dates, estimates, interval merging, the 25-hour clock-change
day, cell counts, empty weeks and proportional geometry. The Chromium rendering
check creates a fictional task through the form, checks both charts and axes,
uses keyboard focus and tooltips, opens task links, moves between weeks, reloads,
and checks phone fit. CI runs it at 1440 × 900 and 390 × 844 alongside the existing
lecture and clock checks. The runner closes its pages, browser and fixture servers
in `finally` and records their ownership and cleanup under `.runtime/e2e`.
