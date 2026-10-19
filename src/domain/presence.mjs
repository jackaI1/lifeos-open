import {lifeosDay} from '../../public/lifeos-day.js';
import { DEFAULT_TIME_ZONE, instant, localDate, zonedDateTime } from './time.mjs';

export function derivePresenceLedger({ date, events = [], corrections = [], settings = {}, prayer = {} }) {
  const timeZone = settings.timeZone ?? DEFAULT_TIME_ZONE;
  const rounding = settings.latenessRounding ?? 'ceil';
  if (!['ceil', 'floor', 'nearest'].includes(rounding)) throw new RangeError('Choose ceil, floor or nearest lateness rounding');
  const rate = settings.latenessPerMinute ?? 1, cap = settings.latenessCap ?? 30;
  if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(cap) || cap < 0) throw new RangeError('Invalid provisional ledger limits');
  const seen = new Map(), observations = [], review = [];
  for (const event of events) {
    if (!event.id || !event.occurredAt || !['home', 'campus'].includes(event.zone) || !['arrival', 'departure'].includes(event.type)) { review.push({ id: event.id ?? null, reason: 'invalid-event' }); continue; }
    let day;
    try { day = lifeosDay(event.occurredAt,timeZone); } catch { review.push({ id: event.id, reason: 'invalid-time' }); continue; }
    if (day !== date) continue;
    if (seen.has(event.id)) {
      const previous = seen.get(event.id);
      if (previous.occurredAt !== event.occurredAt || previous.zone !== event.zone || previous.type !== event.type) { previous.uncertain = true; review.push({ id: event.id, reason: 'conflicting-duplicate' }); }
      continue;
    }
    const future = event.receivedAt && instant(event.occurredAt) > instant(event.receivedAt) + 5 * 60_000;
    const uncertain = event.authenticated !== true || event.confidence === 'ambiguous' || event.confidence === 'spoof-suspected' || future;
    const observation = { ...event, uncertain, delayed: Boolean(event.receivedAt && instant(event.receivedAt) - instant(event.occurredAt) > 15 * 60_000), evidence: event.source === 'manual' ? 'self-reported' : 'observed' };
    seen.set(event.id, observation); observations.push(observation);
    if (uncertain) review.push({ id: event.id, reason: 'uncertain-presence' });
  }
  observations.sort((a, b) => instant(a.occurredAt) - instant(b.occurredAt));
  // Overlapping home/campus arrivals are observations requiring correction, not proof of travel.
  for (let index = 1; index < observations.length; index++) {
    const first = observations[index - 1], next = observations[index];
    if (first.type === 'arrival' && next.type === 'arrival' && first.zone !== next.zone && instant(next.occurredAt) - instant(first.occurredAt) < 2 * 60_000) {
      first.uncertain = next.uncertain = true;
      review.push({ id: next.id, reason: 'overlapping-zones' });
    }
  }
  const dayCorrections = corrections.filter(c => c.date === date && c.authorized === true && c.id && c.correctedAt).sort((a, b) => instant(a.correctedAt) - instant(b.correctedAt));
  const undone = new Set(dayCorrections.filter(c => c.undoes).map(c => c.undoes));
  const correction = dayCorrections.filter(c => !c.undoes && !undone.has(c.id)).at(-1);
  let arrival = observations.find(e => e.zone === 'campus' && e.type === 'arrival' && !e.uncertain);
  if (correction?.arrivalAt && lifeosDay(correction.arrivalAt,timeZone) === date) arrival = { occurredAt: correction.arrivalAt, evidence: 'self-reported', id: correction.id };
  const exception = correction?.exception === true;
  const target = instant(zonedDateTime(date, settings.campusArrivalTime ?? '08:30', { timeZone }));
  const exactMinutes = arrival ? Math.max(0, (instant(arrival.occurredAt) - target) / 60_000) : null;
  const roundedMinutes = exactMinutes === null ? null : Math[rounding === 'nearest' ? 'round' : rounding](exactMinutes);
  const release = instant(zonedDateTime(date, settings.releaseTime ?? '17:00', { timeZone }));
  const earlyDepartures = observations.filter(e => e.zone === 'campus' && e.type === 'departure' && instant(e.occurredAt) < release).map(e => ({ ...e, prayerState: prayer.complete ? 'reported-complete' : 'unknown-or-incomplete', requiresReview: true }));
  return { date, status: exception ? 'excepted' : arrival ? 'provisional' : 'unknown', arrivalAt: arrival?.occurredAt ?? null, evidence: arrival?.evidence ?? 'unknown', exactMinutes, roundedMinutes, amount: exception ? 0 : roundedMinutes === null ? null : Math.min(cap, roundedMinutes * rate), currency: settings.currency ?? 'CAD', rounding, cap, automaticPayment: false, observations, earlyDepartures, review, correction: correction ?? null, audit: dayCorrections };
}
