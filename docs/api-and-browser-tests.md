# API and browser tests for the demo

These checks run against a disposable copy of the local LifeOS workspace. The
copy uses a temporary SQLite database filled with fictional records. The runner
starts it, records its process ID, port and cleanup command, and removes it at
the end. The checks never open a personal workspace.

## What runs

| Check | Tool | Files | What it covers |
| --- | --- | --- | --- |
| API requests | Postman collection run by Newman | `test/api/` | Reads, calendar saves, task deadlines and bad input, one CSV row per request |
| Browser flows | Python, Selenium and pytest | `test/selenium-python/` | Add an event, create a task and move its deadline, compare the Today schedule with the API |
| Pipeline | Jenkins in a pinned container | `Jenkinsfile`, `deploy/jenkins/` | Runs the unit, API and browser stages and publishes their reports |

GitHub Actions runs the API and browser checks in `.github/workflows/api-browser-tests.yml`.
The Jenkins workflow (`.github/workflows/jenkins.yml`) boots the pinned Jenkins
image and runs the same stages inside it.

## Run the API checks

```sh
npm ci
npm run build
npm run test:api
```

Node.js 24 or newer is required. Reports go to `test-results/api/`: one JUnit
XML file per folder and a `summary.json` with the process and cleanup details.

## Run the browser checks

Install Chrome or Chromium, then:

```sh
python3 -m pip install -r test/selenium-python/requirements.txt
npm run build
npm run test:selenium
```

Optional settings:

- `LIFEOS_PYTHON` chooses the Python interpreter (default `python3`).
- `CHROME_BIN` and `CHROMEDRIVER` point at a specific browser and driver. When
  they are unset, Selenium Manager finds a matching driver.
- `LIFEOS_TEST_URL` runs the browser checks against another disposable
  workspace that is already running. Do not point it at a personal workspace,
  because the checks create events and tasks.

Failed browser checks save a screenshot to `test-results/selenium/`.

## How the API table works

Each folder in `lifeos-local.postman_collection.json` is one request. Newman
runs that request once per row of its CSV file in `test/api/data/`:

- `read-cases.csv` covers health, session, bootstrap, schedule and unknown
  routes.
- `calendar-cases.csv` covers calendar saves. It has valid events, cancellation,
  an end time before the start, a zero-length or multi-day event, an unreadable
  time, an empty or 301-character title, an unsupported field, a stale version,
  malformed JSON, and missing or wrong CSRF tokens.
- `task-create-cases.csv` creates tasks with and without a deadline and rejects
  unknown courses, impossible dates, negative or oversized minutes and empty
  titles.
- `task-change-cases.csv` moves a seeded deadline, then rejects stale versions,
  out-of-range difficulty, negative estimates, impossible dates and unknown tasks.

The collection gets its CSRF token from `/api/session` before each write, as
the browser does. A row's `expectedStatus` and `expectedCode` must match the
response. To add a case, add a row. Keep values free of commas, because the
tables are plain CSV.

## Browser page objects

`pages.py` holds the selectors and the explicit waits. The tests never sleep.
A waiting helper polls for a condition such as a dialog closing, a schedule row
appearing, or a deadline text changing. Date and time inputs are set directly
and then announced with `input` and `change` events, because typing into native
pickers depends on the browser locale.

Each test opens one Chrome window and quits it in teardown, including when the
test fails. The driver fixture is in `conftest.py`.

## Cleanup

`tools/lib/disposable-workspace.mjs` does the following:

1. Picks a free loopback port.
2. Starts `src/local/main.ts` with a temporary database and a minimal
   environment, so personal settings are not inherited.
3. Writes `ownership.json` (owner, PID, start time, port, cleanup command) next
   to the temporary database. The runners copy the PID, port and cleanup result
   into `test-results/api/summary.json` or `test-results/selenium/workspace.json`.
4. Sends SIGTERM, then SIGKILL after five seconds if needed.
5. Checks that the PID is gone, the port no longer answers, and the temporary
   directory is removed. It fails the run if any check does not hold.

The runner also kills the server if the runner process exits unexpectedly.

## Unit checks for the suite

`test/api-browser-suite.test.mjs` runs with `npm test`. It checks that the
collection folders match the runner, every CSV row has a valid expected status,
the bad-input cases cover the validation rules, the Python packages are pinned
exactly, and the Jenkinsfile declares both stages and publishes their reports.

## Jenkins

The Jenkinsfile stages `API tests` and `Browser tests` come after the build.
The pinned Jenkins image in `deploy/jenkins/Dockerfile` installs Chromium,
`chromium-driver`, and a Python virtual environment that holds the pinned
Selenium and pytest versions. The Browser stage sets `LIFEOS_PYTHON`,
`CHROME_BIN` and `CHROMEDRIVER` to those paths.
