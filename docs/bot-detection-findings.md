# Visitor check: findings from the Chromium harness

I ran the visitor check against real Chromium in three modes and three kinds of input, and wrote
down which signals fired. The numbers below come from the artifact of the "Bot detection harness"
GitHub Actions run on commit `d8e8014`, file `bot-detection.json`. They are a record of what this
check sees in these three automated browsers. They are not a measure of how well it tells people
from bots.

## What was run

- **headed**: Chromium with a visible window, under a virtual display (xvfb) on the CI runner.
- **headless**: Playwright's headless Chromium.
- **stealth**: headless Chromium with the `AutomationControlled` switch and a small init script
  that hides `navigator.webdriver` and reports a user agent without `HeadlessChrome`.
- **none**: the page loads, and the check reads signals for three seconds with no input.
- **trusted-regular**: Playwright moves the mouse 24 times, 60 ms apart. Those events are trusted.
- **scripted**: the page dispatches 24 synthetic pointer events, 60 ms apart. Those events are untrusted.

## Results

| mode | input | verdict | signals that fired |
| --- | --- | --- | --- |
| headed | none | automated | webdriver-flag, software-renderer |
| headed | trusted-regular | automated | webdriver-flag, software-renderer, regular-input-timing |
| headed | scripted | automated | webdriver-flag, untrusted-input, software-renderer, regular-input-timing |
| headless | none | automated | webdriver-flag, headless-user-agent, software-renderer |
| headless | trusted-regular | automated | webdriver-flag, headless-user-agent, software-renderer, regular-input-timing |
| headless | scripted | automated | webdriver-flag, headless-user-agent, untrusted-input, software-renderer, regular-input-timing |
| stealth | none | automated | software-renderer, no-plugins-chrome-ua |
| stealth | trusted-regular | automated | software-renderer, regular-input-timing, no-plugins-chrome-ua |
| stealth | scripted | automated | untrusted-input, software-renderer, regular-input-timing, no-plugins-chrome-ua |

## What the numbers show

- **Script-made input is caught.** In every mode, the `scripted` run fired `untrusted-input`. The
  `trusted-regular` runs did not, so the check does tell Playwright's real input apart from events
  made by page script.
- **The stealth patch hides `navigator.webdriver`.** The `webdriver-flag` signal fires in headed
  and headless runs and not in stealth runs. Stealth still fires `no-plugins-chrome-ua` (its
  user agent looks like Chrome, but it reports no plugins) and `software-renderer`.
- **`headless-user-agent` catches only plain headless Chromium.** The stealth user agent removes
  that token.
- **Timing rules fire on steady input.** The 60 ms steps produced a standard deviation under the
  3 ms threshold, so `regular-input-timing` fired for both the trusted and the scripted input.
  A real hand moves with much more variation, which these runs do not show.
- **No run reached `human`.** That is the honest result. The verdict needs no firing signal, and
  `webdriver-flag` or `software-renderer` fired in every run.

## What the numbers do not show

- **No real visitor was tested.** Every run is a scripted browser. I have not measured a false
  positive, meaning a person flagged as automated, and I cannot claim any rate for one.
- **`software-renderer` is probably a CI artifact.** GitHub's Linux runners have no GPU, so WebGL
  reports SwiftShader. On a real laptop that signal would usually be clear, so its firing here says
  nothing about bots in general.
- **Stealth is a small patch set, not a full stealth library.** It is enough to show which signals
  the patches hide and which they leave behind. A well-maintained stealth tool would hide more.
- **One browser version, one operating system.** The results come from the Chromium build that
  Playwright installs on Ubuntu in CI.

## What I would do next

- Run the check on a few real browsers on my own machines, with consent, and record the verdicts
  before drawing any conclusion about people.
- Weigh `software-renderer` lower, or check it only when the machine is known to have no GPU.
- Look at timing with real input, where the spacing between events varies from person to person.

The harness is `tools/bot-detection-harness.mjs`, the scorer is `public/bot-check/scorer.mjs`,
and the integration test is `test/bot-detection-harness.integration.mjs`. To rerun it on a machine
where a window can open, use `npm run test:bot-harness`.
