# Choosing a clearer way to add a task

I want a new visitor to know where to start planning coursework. I compare the
Academics button **New task** with **Plan a task**, then count whether a visitor
saves a task after seeing that button. An A/B test means showing one of two
versions consistently and comparing what people do afterwards.

## Try it without an account

```sh
npm ci
npm run build
node tools/build-hosted-assets.mjs
python3 -m http.server 8788 --bind 127.0.0.1 --directory .runtime/hosted/assets
```

Open http://127.0.0.1:8788/#school, choose **Allow analytics**, and use the task
button to save a fictional task. The label is either **New task** or **Plan a task**.
Open **Task label experiment** at the bottom of the screen to see the local counts
and download them as JSON. The report correctly says **not enough data** for one
browser. Stop the temporary server with Ctrl-C when finished.

The browser-only demo includes this experiment by default. The standalone app
started with `npm run dev` does not. No Google account, key or tracking service is
needed. Without configured Google reporting, the permission banner explicitly
asks for local counts and nothing is uploaded. If optional Google reporting is
configured, its existing consent also gates this local experiment; experiment
identifiers and events are never added to its data layer or sent to Google.

**No thanks**, Global Privacy Control and Do Not Track keep the original label,
create no experiment identifier and log no events. Changing **Analytics: on** to
**No thanks** erases the local experiment state and invalidates saves already in
flight. Regranting creates a new anonymous participant. Clearing browser storage
also starts over, so a participant means a browser installation, not a person.

To stop the experiment while keeping the rest of the demo, add
`<meta name="lifeos-experiment-task-entry" content="off">` to the public demo's
HTML before loading it. The disabled flag serves **New task** and logs nothing.
Changing allocation, labels, outcomes or the statistical plan requires a new
experiment ID and storage key.

## What the framework measures

After permission, it generates a random browser ID and hashes that ID together
with `academic-task-entry-v1` using SHA-256. The first 32 bits select one of two
equal groups. Reloading preserves the ID and assignment; changing the workspace
or its fictional records does not change the assignment.

The local log holds the ID and two optional event timestamps:

- **Exposure:** the enabled task button intersects the viewport on a visible
  Academics page. Disabled, hidden and detached buttons do not count. This checks
  screen visibility, not whether a human actually read the label.
- **Outcome:** the first successful new-task write begun after exposure and while
  permission is still granted, within 24 hours. Edits, failed or queued saves,
  writes to other origins and saves started before exposure do not count.

Reloads and repeated saves count once. The identifier, timestamps, task titles,
record IDs and all workspace contents are excluded from downloaded counts.
Storage failures fall back to memory for that page; stable assignment across
reloads then cannot be guaranteed. Tabs share state through storage events;
this small local demonstration is not a transactional multi-tab collector.

## Read a comparison

```sh
npm run experiment:report
npm run experiment:report -- /path/to/counts.json
```

The first command runs two clearly labelled **synthetic** examples. With 20
exposures per group and 1 versus 19 conversions it refuses to name a winner.
With 1,200 per group and 240 versus 300 conversions, it reports 20% versus 25%,
a two-sided p-value about 0.00336 and a difference interval of 1.66 to 8.34
percentage points. These examples are not evidence that either label works
better for LifeOS visitors.

The second command reads this aggregate format, including the experiment ID:

```json
{
  "experiment": "academic-task-entry-v1",
  "control": {"exposures": 1200, "conversions": 240},
  "treatment": {"exposures": 1200, "conversions": 300}
}
```

A real comparison needs an independently collected, deduplicated cohort. There
is no central collector in this version: a browser export contains only that
browser, not all site traffic. Never add repeated exports of the same browser,
merge overlapping cohorts, or call the synthetic examples visitor results.

## The statistical plan

I set the plan before collecting data: a 20% baseline, a smallest useful change
of 5 percentage points, 80% power (the chance of detecting that change), and a
two-sided 5% significance threshold. The equal-group normal approximation is
`ceil((z_0.975*sqrt(2*pbar*(1-pbar)) + z_0.8*sqrt(p0*(1-p0)+p1*(1-p1)))^2 / (p1-p0)^2)`.
It requires **1,094 exposed browsers per group**. It is an approximate design
calculation based on an assumed baseline, not measured LifeOS traffic or a
promise of power at every possible true conversion rate.

The analysis returns `not enough data`, with no p-value or winner, until both
groups reach that target and each has at least 10 conversions and 10
non-conversions. It then computes the [pooled two-proportion z-test](https://www.itl.nist.gov/div898/software/dataplot/refman2/auxillar/diffprci.htm),
a comparison of two conversion fractions. Each fraction has a Wilson 95%
confidence interval; the treatment-minus-control difference uses the
[unpooled normal 95% interval](https://www.itl.nist.gov/div898/software/dataplot/refman1/auxillar/diffprop.htm).
A winner needs both `p < .05` and a difference interval excluding zero. Otherwise
it reports `no clear difference`. No difference does not prove equivalence.

The design assumes independent randomized browsers and one binary outcome per
browser. Stop enrollment after the planned cohort, let every enrolled browser's
24-hour window finish, disable the flag, then make one final comparison. Repeated
peeking, changing the plan mid-test, or stopping when a result looks good makes
the reported significance unreliable. The report command cannot enforce that
collection protocol. This is one experiment, with no correction for running
many comparisons. A small p-value alone does not establish practical value.

## Files and checks

`src/analytics/experiments/controller.ts` owns assignment, permission and the
local event log. `browser.ts` connects the real Academics button and successful
writes to that controller. `analysis.ts` contains the declared plan, intervals
and test; `tools/experiment-report.mjs` runs it without a browser.

`node --test test/experiments.test.mjs` checks stable hash assignments, flags,
permission transitions, duplicate events, reloads, the outcome window and
independent numerical references. `node --test tools/experiments-browser.test.mjs`
uses the real browser SQLite workspace and task form for both variants, exports
counts and checks withdrawal, the disabled flag and a browser privacy signal.
CI runs these alongside the existing tests, build, lint, type checks and privacy
check. The browser test closes its pages and server in `finally` and records
process ownership and port cleanup under the ignored `.runtime/experiments/`.
