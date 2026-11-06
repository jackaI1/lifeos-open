/** Fixed, predeclared plan: 20% baseline, detect 5 percentage points, 80% power,
 * two-sided alpha .05. Changing the screen or plan requires a new experiment id. */
export const PLAN = Object.freeze({baseline: .2, minimumEffect: .05, power: .8, alpha: .05});
export const EXPERIMENT = 'academic-task-entry-v1';
export type Variant = 'control' | 'treatment';
export interface Counts { exposures: number; conversions: number }
export interface ExperimentCounts { experiment: string; control: Counts; treatment: Counts }
const Z95 = 1.959963984540054;
const Z80 = .8416212335729143;
export function requiredPerVariant(): number {
  const p0 = PLAN.baseline, p1 = p0 + PLAN.minimumEffect, mean = (p0 + p1) / 2;
  return Math.ceil(((Z95 * Math.sqrt(2 * mean * (1 - mean)) + Z80 * Math.sqrt(p0 * (1 - p0) + p1 * (1 - p1))) / PLAN.minimumEffect) ** 2);
}
// Numerical Recipes erfc approximation, absolute error below 1.5e-7.
function erfc(x: number): number {
  const t = 1 / (1 + .5 * Math.abs(x));
  const value = t * Math.exp(-x*x - 1.26551223 + t*(1.00002368 + t*(.37409196 + t*(.09678418 + t*(-.18628806 + t*(.27886807 + t*(-1.13520398 + t*(1.48851587 + t*(-.82215223 + t*.17087277)))))))));
  return x >= 0 ? value : 2 - value;
}
function validate(c: Counts): void {
  if (!c || !Number.isSafeInteger(c.exposures) || !Number.isSafeInteger(c.conversions) || c.exposures < 0 || c.conversions < 0 || c.conversions > c.exposures) throw Error('Counts must be nonnegative safe integers, with conversions <= exposures.');
}
/** Wilson score interval stays within [0,1], including at zero/all conversions. */
export function conversion(c: Counts) {
  validate(c);
  const n = c.exposures;
  if (!n) return {...c, rate: null, ci95: null};
  const p = c.conversions / n, z2 = Z95 ** 2, denominator = 1 + z2/n;
  const centre = (p + z2/(2*n))/denominator;
  const half = Z95*Math.sqrt(p*(1-p)/n + z2/(4*n*n))/denominator;
  return {...c, rate: p, ci95: [Math.max(0, centre-half), Math.min(1, centre+half)]};
}
/** Two independent binomial samples; pooled z-test, unpooled difference interval.
 * Counts represent unique exposed browsers, with at most one conversion each. */
export function analyze(input: ExperimentCounts) {
  if (!input || input.experiment !== EXPERIMENT) throw Error('Unknown experiment or incompatible plan.');
  const control = conversion(input.control), treatment = conversion(input.treatment);
  const minimumPerVariant = requiredPerVariant();
  const reasons: string[] = [];
  for (const [name, c] of Object.entries({control, treatment})) {
    if (c.exposures < minimumPerVariant) reasons.push(`${name} needs ${minimumPerVariant} exposed browsers`);
    if (c.conversions < 10 || c.exposures - c.conversions < 10) reasons.push(`${name} needs at least 10 conversions and 10 non-conversions`);
  }
  const base = {experiment: EXPERIMENT, plan: PLAN, minimumPerVariant, control, treatment};
  if (reasons.length) return {...base, status: 'not enough data', reasons, winner: null, z: null, pValue: null, difference: null, differenceCi95: null};
  const n0 = control.exposures, n1 = treatment.exposures, p0 = control.rate!, p1 = treatment.rate!;
  const pooled = (control.conversions + treatment.conversions)/(n0+n1);
  const difference = p1-p0;
  const z = difference / Math.sqrt(pooled*(1-pooled)*(1/n0+1/n1));
  const pValue = Math.min(1, erfc(Math.abs(z)/Math.SQRT2));
  const half = Z95*Math.sqrt(p0*(1-p0)/n0 + p1*(1-p1)/n1);
  const differenceCi95 = [Math.max(-1, difference-half), Math.min(1, difference+half)];
  const significant = pValue < PLAN.alpha && (differenceCi95[0] > 0 || differenceCi95[1] < 0);
  return {...base, status: significant ? 'winner' : 'no clear difference', reasons, winner: significant ? (difference > 0 ? 'treatment' : 'control') : null, z, pValue, difference, differenceCi95};
}
