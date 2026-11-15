# Bot check notes

I built a bot check for the public demo because I want the usage numbers to count
people, not scripts. The check reads a few browser signals, scores them, and says
whether a visitor looks scripted, looks like a person, or is not clear enough to
call. It never guesses. Nothing is stored, and nothing is collected until the visitor
agrees.

## What it reads

The browser collector (`src/bot-detection/browser.js`) runs only when it is called
with `consent: true`. It reads these values and sends none of them anywhere:

| Signal | What it means |
| --- | --- |
| `webdriver` | The browser says it is controlled by automation |
| `userAgentHeadless` | The user agent contains `HeadlessChrome` |
| `pluginCount`, `chromeObject`, `languageCount` | Parts of a normal Chromium profile that headless setups often leave out |
| `outerSizeZero` | The window reports zero size |
| `webglClass` | `software`, `hardware`, `none` or `unknown`. The GPU name is never kept |
| `canvasRepeatable` | Drawing the same canvas twice gives the same bytes |
| `inputEvents`, `untrustedRatio`, `intervalCv` | Pointer events over three seconds: how many were not made by the user, and how regular the timing is |

## How the verdict is made

`src/bot-detection/score.mjs` is a pure function. Each rule adds or subtracts
points. A score of 6 or more is `automated`. A score of -3 or less is `human-like`.
Anything in between, or any run with fewer than four readable signals, is
`uncertain`. Each verdict lists the rules that fired, with a sentence for each.

## Run it

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium
node --test test/bot-scorer.test.mjs          # the scorer, no browser needed
LIFEOS_BOT_HARNESS=1 node --test test/bot-harness.integration.test.mjs
node tools/bot-harness.mjs                     # prints the table, writes test-results/bot-harness.json
```

Headed mode opens a real window, so on Linux run it under a virtual display with
`xvfb-run -a`. The CI workflow does this. Use it on a laptop only if you accept the
window opening.

## Measured results

Run 43668526648 on the GitHub Ubuntu 24.04 runner, Playwright's bundled Chromium,
virtual display for headed mode. Each row is one browser mode and one input pattern.

| Mode | Input pattern | Verdict | Score | Rules that fired |
| --- | --- | --- | --- | --- |
| headed | human-like | uncertain | 2 | webdriver, software-renderer, plugins-present, trusted-varied-input |
| headed | scripted events | automated | 12 | webdriver, software-renderer, synthetic-events, metronomic-input, plugins-present |
| headed | no input | uncertain | 5 | webdriver, software-renderer, plugins-present |
| headless | human-like | automated | 11 | webdriver, headless-user-agent, no-chrome-object, no-plugins-on-chromium, software-renderer, trusted-varied-input |
| headless | scripted events | automated | 21 | all headless rules plus synthetic-events and metronomic-input |
| headless | no input | automated | 14 | the static headless rules |
| stealth-patched | human-like | uncertain | -2 | software-renderer, plugins-present, trusted-varied-input |
| stealth-patched | scripted events | automated | 8 | software-renderer, synthetic-events, metronomic-input, plugins-present |
| stealth-patched | no input | uncertain | 1 | software-renderer, plugins-present |

## What the table says

- **Headless is caught in every pattern.** The headless user agent, the missing
  Chromium objects and the missing plugins all fire, and the verdict is `automated`
  even when the input looks human.
- **The stealth patch hides the flags it targets.** `webdriver` and
  `headless-user-agent` disappear, and the plugin and `window.chrome` rules pass.
  A verdict of `human-like` still does not appear, because the software renderer
  and the lack of real-user input keep the score above -3.
- **Scripted events are caught in every mode, including the patched one.** The
  untrusted-event and fixed-interval rules did not depend on any browser flag.
- **Headed does not look fully human here.** Playwright sets `navigator.webdriver`
  in headed mode too, so the headed run still carries that flag. Software rendering
  on the virtual display also fires the renderer rule. On a Mac with a GPU this
  rule would not fire, but I have not measured that on a Mac here.
- **Some rules never fired.** `unstable-canvas`, `no-webgl`, `zero-outer-window` and
  `not-webdriver` were false in every run. They are kept because real browsers
  differ, but they add no evidence in this matrix.

## False positives

The one check against a normal browser was the headed human-like run. It came out
`uncertain`, not `automated`, so it was not called a bot. It did not come out
`human-like` either, for the reasons above. A real person on a Mac would look
different from this run. I have not measured real visitors, so the false-positive rate
for real traffic is unknown.

## Limits

- The "human-like" pattern is Playwright with random pauses and steps. It is not a
  real person, and it is trusted input, so it tests the timing rules only.
- The stealth patch is a few lines I wrote (`tools/bot-harness.mjs`). It is not a
  full stealth library, and it does not change GPU or canvas behaviour.
- The collector is in the repository, but the hosted demo does not yet show a consent
  banner or send verdicts. Wiring that in is the next step.
- The integration tests need a display for headed mode and Chromium for every mode,
  so they run only in the `bot-detection` workflow, not in the default test run.
