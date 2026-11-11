# Performance tests for LifeOS

I wrote these load tests because I want to know how many people my self-hosted LifeOS
server can handle before I invite anyone else to use it. Each test signs in, reads the
calendar, adds a calendar event, looks up tasks and then pauses, the way a person
using the app would. The results tell me how fast the server answers, whether it
runs out of memory, and whether memory keeps growing over a long run.

## What runs

Apache JMeter is a load-testing program. It runs these four plans, each against a
fresh copy of the server with fictional data:

| Plan | What it asks | Length |
| --- | --- | --- |
| `benchmark` | How fast does one user get answers when nothing else is running? | 100 sessions, no pauses |
| `load` | Does the server stay fast with 25 users working at the same time? | 2 min ramp, 15 min |
| `stress` | Where does it break? 200 users, past what I expect to use | 10 min ramp, 15 min |
| `endurance` | Does memory creep up over a long run? | 2 hours with 15 users |

Every user does the same journey: sign in once, read calendar events, write one
calendar event, look up tasks, then wait one to one and a half seconds before the next
round. Each plan starts a new server, so the runs do not affect each other.

LifeOS has no free-text search endpoint yet. The "Search tasks" request is the paged
task lookup the app uses to find tasks. I will rename it if I add real search.

While a plan runs, the orchestrator also records, every few seconds:

- **CPU** and **memory** (resident set size, the RAM the Node process actually holds);
- **SQLite timings**: two fixed read queries on the workspace file, using a read-only
  connection that cannot change anything;
- **Garbage collection** pauses. Node starts with `--trace-gc`, which logs every time it
  stops the program to free memory, and the pauses are summed from that log.

## How to run it

You need Node 24, Java 17 or later, and Apache JMeter 5.6.

```
npm ci
npm run build
python3 perf/jmeter/run_suite.py --profile smoke           # about 3 minutes of test time
python3 perf/jmeter/run_suite.py --profile full --plans load   # one real plan
```

Set `JMETER_BIN` if `jmeter` is not on your PATH. Results go to `perf/jmeter/results/`:

- `report.md` lists the pass/fail checks and the request table;
- `report.html` shows the memory, CPU and SQLite charts for each plan;
- `<plan>/dashboard/index.html` is JMeter's own dashboard for that plan;
- `summary.json` has every number in machine-readable form.

To run the analysis again on existing results: `python3 perf/jmeter/analyze.py perf/jmeter/results`.

## Pass and fail limits

The limits are in [`plans.json`](plans.json), next to each plan. Each plan fails if its
95th-percentile response time (the time that 95 of every 100 requests beat) is too high,
if too many requests fail, or if the server uses too much CPU or memory.

The **leak check** runs on the endurance plan. It reads the memory samples after the first
quarter of the run (warm-up, when memory rises normally) and fits a straight line. It flags
the run when all three are true:

1. memory rises more than 5 MB an hour;
2. the rise is steady (the straight line explains at least 60 per cent of the variation);
3. memory grows by at least 5 per cent over the evaluated part.

A flag fails the endurance plan. Runs shorter than 30 minutes are not evaluated, because
warm-up alone looks like growth. The smoke profile is short, so its leak check says so.

## Where the numbers come from

- The server is the real production build, `build/server.mjs`, with the same environment
  variables as the Linux service, not a test double.
- Resource numbers on Linux come from `/proc`, which the kernel updates on every read.
  On macOS the script uses `ps`, which reports CPU time in whole seconds, so short
  intervals are less precise there. CI runs on Linux.
- The SQLite probe reads the workspace while the server writes to it. Its timings show
  how long a read takes under load. They are not a full profile of every query.

## Files

| Path | Purpose |
| --- | --- |
| `plans.json` | The settings, smoke overrides and pass/fail limits for each plan, and the leak check |
| `build_plans.py` | Writes `plans/*.jmx` from `plans.json`. The tests fail if the committed files are stale |
| `plans/*.jmx` | The four JMeter plans |
| `run_suite.py` | Starts and stops the server, seeds data, runs JMeter, samples resources, then writes the report |
| `resources.py` | CPU, memory, SQLite and GC sampling |
| `analyze.py` | Percentiles, pass/fail checks, the leak check and the reports |
| `tests/test_perf.py` | Tests for the parsing, the statistics and the leak check, with no server needed |

## Tests and CI

`python3 -m unittest discover -s perf/jmeter/tests -v` runs the analysis tests without a
server or JMeter. The `Performance smoke` workflow runs them, checks that the committed
plans match the generator, and then runs the smoke profile in JMeter's non-GUI mode. It
uploads the report and dashboards as an artifact.

## Limits

- The smoke profile runs for about three minutes of test time, plus the server build. Its numbers show
  that the test runs, not how the server performs. Use `--profile full` on a machine you
  control for real limits.
- The stress plan shows where errors start, not a single capacity figure.
- The leak check finds steady growth. A leak that grows only after many hours, or only on
  some rare path, can pass it.
