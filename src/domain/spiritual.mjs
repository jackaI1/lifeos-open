import {lifeosDay} from '../../public/lifeos-day.js';
import {practiceDay} from '../../public/devotional-day.js';
import { DEFAULT_TIME_ZONE, localDate, instant, zonedDateTime, minutesBetween } from './time.mjs';

export function devotionalCompletion({ points = [], confirmed = false, completedAt = null, historical = false }) {
  const answered = points.filter(value => typeof value === 'string' && value.trim()).length;
  return { answered, complete: historical ? null : points.length === 7 && answered === 7 && confirmed === true, completedAt, requiresConfirmation: !historical && answered === 7 && !confirmed, historical };
}

/** Archive/upload time must never become the time a practice happened. */
export function schoolReleaseExtension({ date, devotional, timeZone = DEFAULT_TIME_ZONE }) {
  if (!devotional?.complete || !devotional.completedAt) return 0;
  if (lifeosDay(devotional.completedAt, timeZone) !== date) return 0;
  if (devotional.plan !== 'B' || devotional.context !== 'planned-school-time') return 0;
  return Number(devotional.schoolMinutes) >= 30 ? 30 : 0;
}

export function assessSpiritualPlans({ date, now, devotional = {}, prayer = {}, campusSlots = [], settings = {} }) {
  const timeZone = settings.timeZone ?? DEFAULT_TIME_ZONE;
  const enabled = settings.spiritualPracticesEnabled === true;
  const clock = time => instant(zonedDateTime(date, time, { timeZone }));
  const current = instant(now);
  const extensionMinutes = enabled ? schoolReleaseExtension({ date, devotional, timeZone }) : 0;
  const release = clock(settings.releaseTime ?? '17:00') + extensionMinutes * 60_000;
  const recovery = clock(settings.recoveryTime ?? '20:30');
  const cutoff = clock(settings.outOfBedCutoff ?? '06:45');
  const morningEnd = clock(settings.wakeTime ?? '06:30') + 40 * 60_000;
  const observedLateWake = Boolean(settings.observedWakeAt && instant(settings.observedWakeAt) > cutoff && lifeosDay(settings.observedWakeAt, timeZone) === date);
  const choose = (kind, state) => {
    if (state.complete && practiceDay(state,kind,timeZone) === date) return { kind, complete: true, plan: 'complete', completedAt: state.completedAt??null, evidence: state.evidence ?? 'self-reported', action: 'Review completion' };
    if (!enabled) return { kind, complete: false, plan: 'optional', suggestion: 'Open this practice whenever you choose.', slot: null, evidence: state.evidence ?? 'unknown', action: kind === 'prayer' ? 'Start prayer' : 'Start devotional' };
    const available = campusSlots.find(slot => instant(slot.end) > current && minutesBetween(Math.max(current, instant(slot.start)), slot.end) >= (kind==='prayer'?15:30) && (!slot.kind || slot.kind === kind));
    let plan, suggestion, slot = null;
    if (current >= recovery) { plan = 'D'; suggestion = 'Use a safe indoor recovery block before bed.'; }
    else if (current >= release) { plan = 'C'; suggestion = kind === 'prayer' ? 'Use the walk home, or a safe indoor place.' : 'Use a quiet place before heading home when safe.'; }
    else if (kind === 'devotional' && current <= morningEnd && !observedLateWake) { plan = 'A'; suggestion = 'Begin after brushing teeth and before washing your face.'; }
    else if (kind === 'prayer' && current < clock(settings.campusArrivalTime ?? '08:30')) { plan = 'A'; suggestion = 'Begin on the first walk to campus; finish somewhere safe if needed.'; }
    else if (available) { plan = 'B'; suggestion = kind === 'devotional' ? 'Use the next available campus block.' : 'Use the next available campus walking or quiet block.'; slot = available; }
    else { plan = 'C'; suggestion = kind === 'prayer' ? 'Reserve prayer for the walk home or a safe indoor alternative.' : 'Reserve a quiet block before heading home when safe.'; }
    return { kind, complete: false, plan, suggestion, slot, evidence: state.evidence ?? 'unknown', action: kind === 'prayer' ? 'Start prayer' : 'Start devotional' };
  };
  return { devotional: choose('devotional', devotional), prayer: choose('prayer', prayer), extensionMinutes, wakeEvidence: settings.observedWakeAt ? 'observed' : 'unknown', physicalRestriction: false };
}
