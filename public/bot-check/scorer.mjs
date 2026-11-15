// Pure scorer for browser signals. It never touches the page, storage or network.
// Each rule reads one signal. A rule whose signal was not collected is "unavailable",
// never "clear", so missing evidence cannot look like a human.

export const RULES = Object.freeze([
  {id: 'webdriver-flag', weight: 3, label: 'navigator.webdriver is set'},
  {id: 'automation-marker', weight: 3, label: 'a known automation marker is present'},
  {id: 'headless-user-agent', weight: 3, label: 'the user agent says HeadlessChrome'},
  {id: 'untrusted-input', weight: 3, label: 'some input events were created by script'},
  {id: 'software-renderer', weight: 2, label: 'WebGL reports a software renderer'},
  {id: 'regular-input-timing', weight: 2, label: 'input events arrive at machine-regular intervals'},
  {id: 'no-plugins-chrome-ua', weight: 1, label: 'a Chrome user agent reports no plugins'},
  {id: 'zero-outer-window', weight: 1, label: 'the browser window reports zero outer size'},
  {id: 'empty-languages', weight: 1, label: 'the browser reports no languages'},
  {id: 'canvas-unavailable', weight: 1, label: 'canvas drawing did not round-trip a pixel'},
]);

// Thresholds are deliberately conservative: a verdict needs strong evidence,
// and a "human" verdict needs real input that was actually observed.
export const AUTOMATED_WEIGHT = 3;
export const MIN_COVERAGE = 0.5;
export const MIN_INTERVALS = 8;
export const REGULAR_STDEV_MS = 3;

const isNumber = value => typeof value === 'number' && Number.isFinite(value);

function evaluate(id, s) {
  switch (id) {
    case 'webdriver-flag':
      return typeof s.webdriver === 'boolean' ? (s.webdriver ? 'fired' : 'clear') : 'unavailable';
    case 'automation-marker':
      return Array.isArray(s.automationMarkers) ? (s.automationMarkers.length ? 'fired' : 'clear') : 'unavailable';
    case 'headless-user-agent':
      return typeof s.userAgent === 'string' ? (/HeadlessChrome/.test(s.userAgent) ? 'fired' : 'clear') : 'unavailable';
    case 'untrusted-input':
      if (!s.input || !isNumber(s.input.count) || s.input.count === 0) return 'unavailable';
      return s.input.untrusted > 0 ? 'fired' : 'clear';
    case 'software-renderer':
      return typeof s.webglRenderer === 'string' ? (/SwiftShader|llvmpipe|software/i.test(s.webglRenderer) ? 'fired' : 'clear') : 'unavailable';
    case 'regular-input-timing':
      if (!s.input || !isNumber(s.input.intervals) || s.input.intervals < MIN_INTERVALS || !isNumber(s.input.intervalStdevMs)) return 'unavailable';
      return s.input.intervalStdevMs < REGULAR_STDEV_MS ? 'fired' : 'clear';
    case 'no-plugins-chrome-ua':
      if (!isNumber(s.plugins) || typeof s.userAgent !== 'string') return 'unavailable';
      return /Chrome\//.test(s.userAgent) && !/HeadlessChrome/.test(s.userAgent) && s.plugins === 0 ? 'fired' : 'clear';
    case 'zero-outer-window':
      if (!isNumber(s.outerWidth) || !isNumber(s.outerHeight)) return 'unavailable';
      return s.outerWidth === 0 || s.outerHeight === 0 ? 'fired' : 'clear';
    case 'empty-languages':
      return isNumber(s.languages) ? (s.languages === 0 ? 'fired' : 'clear') : 'unavailable';
    case 'canvas-unavailable':
      return typeof s.canvasWorks === 'boolean' ? (s.canvasWorks ? 'clear' : 'fired') : 'unavailable';
    default:
      return 'unavailable';
  }
}

const detail = (id, s) => {
  switch (id) {
    case 'webdriver-flag': return `navigator.webdriver=${String(s.webdriver)}`;
    case 'automation-marker': return `${(s.automationMarkers ?? []).length} marker(s)`;
    case 'untrusted-input': return `${s.input?.untrusted ?? 0} of ${s.input?.count ?? 0} events untrusted`;
    case 'regular-input-timing': return `stdev ${s.input?.intervalStdevMs ?? 'n/a'} ms over ${s.input?.intervals ?? 0} intervals`;
    case 'software-renderer': return `renderer ${JSON.stringify(s.webglRenderer)}`;
    default: return '';
  }
};

/**
 * Score collected signals. Returns a verdict, the weight of evidence, and one reason per rule.
 * verdict: "automated" (strong evidence), "human" (real input observed, nothing fired),
 * or "uncertain" (weak evidence, or too little information to decide).
 */
export function scoreSignals(signals) {
  const reasons = RULES.map(rule => {
    const status = evaluate(rule.id, signals ?? {});
    return {id: rule.id, weight: rule.weight, label: rule.label, status, detail: detail(rule.id, signals ?? {})};
  });
  const total = RULES.reduce((sum, rule) => sum + rule.weight, 0);
  const firedWeight = reasons.filter(r => r.status === 'fired').reduce((sum, r) => sum + r.weight, 0);
  const availableWeight = reasons.filter(r => r.status !== 'unavailable').reduce((sum, r) => sum + r.weight, 0);
  const coverage = availableWeight / total;
  const inputObserved = reasons.some(r => r.id === 'untrusted-input' && r.status !== 'unavailable');
  let verdict;
  if (firedWeight >= AUTOMATED_WEIGHT) verdict = 'automated';
  else if (firedWeight === 0 && inputObserved && coverage >= MIN_COVERAGE) verdict = 'human';
  else verdict = 'uncertain';
  return {verdict, firedWeight, availableWeight, totalWeight: total, coverage: Number(coverage.toFixed(2)), reasons};
}

/** Summarise input events. Pure, so the timing rule can be tested without a browser. */
export function summarizeInput(events) {
  const observed = events.filter(e => typeof e.trusted === 'boolean');
  const moves = events.filter(e => e.type === 'pointermove').map(e => e.t).sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < moves.length; i++) intervals.push(moves[i] - moves[i - 1]);
  let stdev = null;
  if (intervals.length >= 2) {
    const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    stdev = Math.sqrt(intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length);
  }
  return {
    count: observed.length,
    untrusted: observed.filter(e => e.trusted === false).length,
    intervals: intervals.length,
    intervalStdevMs: stdev === null ? null : Number(stdev.toFixed(2)),
  };
}
