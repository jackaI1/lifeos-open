// Pure scorer for browser signals. It never sees a name, IP address or cookie:
// the browser collector sends only booleans, counts, ratios and a renderer class
// (software, hardware, none or unknown), never the GPU name itself.
// Every positive weight means "looks scripted", every negative weight means
// "looks like a person". A verdict needs enough observed signals and a clear
// score; anything in between is reported as 'uncertain' instead of a guess.

export const VERDICTS = Object.freeze({AUTOMATED: 'automated', HUMAN: 'human-like', UNCERTAIN: 'uncertain'});
export const THRESHOLDS = Object.freeze({automated: 6, human: -3, minimumObserved: 4});


/** Each rule reads one signal. Missing values (null or undefined) never count as evidence. */
export const RULES = Object.freeze([
  {id: 'webdriver', weight: 4, test: s => s.webdriver === true, detail: 'navigator.webdriver is set, which automation frameworks usually set'},
  {id: 'headless-user-agent', weight: 4, test: s => s.userAgentHeadless === true, detail: 'the user agent says HeadlessChrome'},
  {id: 'no-plugins-on-chromium', weight: 2, test: s => s.chromium === true && s.pluginCount === 0, detail: 'a Chromium browser reports no plugins'},
  {id: 'no-chrome-object', weight: 2, test: s => s.chromium === true && s.chromeObject === false, detail: 'a Chromium browser has no window.chrome object'},
  {id: 'no-languages', weight: 2, test: s => s.languageCount === 0, detail: 'the browser reports no preferred languages'},
  {id: 'zero-outer-window', weight: 2, test: s => s.outerSizeZero === true, detail: 'the window has zero outer size'},
  {id: 'software-renderer', weight: 2, test: s => s.webglClass === 'software', detail: 'WebGL uses a software renderer, common in headless browsers and virtual machines'},
  {id: 'no-webgl', weight: 1, test: s => s.webglClass === 'none', detail: 'WebGL is unavailable'},
  {id: 'unstable-canvas', weight: 2, test: s => s.canvasRepeatable === false, detail: 'the same canvas drawing gave different output twice, which some anti-detect tools add on purpose'},
  {id: 'synthetic-events', weight: 4, test: s => s.inputEvents >= 5 && s.untrustedRatio >= 0.5, detail: 'most pointer events were not trusted (created by script)'},
  {id: 'metronomic-input', weight: 3, test: s => s.inputEvents >= 8 && s.intervalCv !== null && s.intervalCv < 0.05, detail: 'input arrives at a fixed interval, with almost no variation'},
  {id: 'trusted-varied-input', weight: -3, test: s => s.inputEvents >= 8 && s.untrustedRatio === 0 && s.intervalCv !== null && s.intervalCv >= 0.25, detail: 'trusted events with natural timing variation'},
  {id: 'plugins-present', weight: -1, test: s => s.pluginCount > 0, detail: 'the browser reports plugins'},
  {id: 'not-webdriver', weight: -1, test: s => s.webdriver === false, detail: 'navigator.webdriver is not set'},
]);

/** Observed means the signal has a real value. Null means the browser refused or the check did not run. */
export function observedCount(signals) {
  return ['webdriver', 'userAgentHeadless', 'pluginCount', 'chromeObject', 'languageCount', 'outerSizeZero', 'webglClass', 'canvasRepeatable', 'untrustedRatio', 'intervalCv']
    .filter(key => signals[key] !== null && signals[key] !== undefined).length;
}

export function scoreSignals(signals) {
  if (!signals || typeof signals !== 'object') throw new TypeError('signals must be an object');
  if (signals.consent !== true) return {verdict: VERDICTS.UNCERTAIN, score: 0, observed: 0, reasons: [], note: 'No consent, so nothing was collected.'};
  const reasons = RULES.filter(rule => {
    try { return rule.test(signals) === true; } catch { return false; }
  }).map(rule => ({signal: rule.id, weight: rule.weight, detail: rule.detail}));
  const score = reasons.reduce((total, reason) => total + reason.weight, 0);
  const observed = observedCount(signals);
  let verdict = VERDICTS.UNCERTAIN;
  if (observed >= THRESHOLDS.minimumObserved) {
    if (score >= THRESHOLDS.automated) verdict = VERDICTS.AUTOMATED;
    else if (score <= THRESHOLDS.human) verdict = VERDICTS.HUMAN;
  }
  const note = verdict === VERDICTS.UNCERTAIN
    ? (observed < THRESHOLDS.minimumObserved ? 'Too few signals could be read to decide.' : 'The signals disagree or are weak, so no verdict is given.')
    : undefined;
  return {verdict, score, observed, reasons, ...(note ? {note} : {})};
}
