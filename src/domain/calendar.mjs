import { DEFAULT_TIME_ZONE, instant, zonedDateTime, overlap, mergeIntervals } from './time.mjs';

const normalizedText = text => String(text ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-CA');

function eventTime(value, timeZone) {
  if (typeof value === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(value) ? zonedDateTime(value, '00:00', { timeZone }) : new Date(instant(value)).toISOString();
  if (value?.dateTime) return new Date(instant(value.dateTime)).toISOString();
  if (value?.date) return zonedDateTime(value.date, '00:00', { timeZone: value.timeZone || timeZone });
  throw new RangeError('Calendar event is missing a valid start or end');
}

/** Input must contain actual expanded calendar instances. This never invents recurrence. */
export function normalizeCalendars({ events = [], allowedCalendarIds = [], schoolCalendarIds = [], timeZone = DEFAULT_TIME_ZONE }) {
  const allowed = new Set(allowedCalendarIds), school = new Set(schoolCalendarIds);
  const errors = [], ignored = [], normalized = [];
  for (const original of events) {
    const calendarId = original.calendarId ?? original.sourceCalendarId;
    if (!allowed.has(calendarId)) { ignored.push({ id: original.id ?? null, calendarId, reason: 'calendar-not-selected' }); continue; }
    try {
      const start = eventTime(original.start, timeZone), end = eventTime(original.end, timeZone);
      if (instant(end) <= instant(start)) throw new RangeError('Calendar duration must be positive');
      const allDay = original.allDay === true || Boolean(original.start?.date) || typeof original.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(original.start);
      // Date-only school-feed notices describe the academic calendar, not a timed
      // class. Preserve them as context. Personal all-day busy events stay busy.
      const dayNotice = allDay && school.has(calendarId) && original.blocksTime !== true;
      normalized.push({ ...original, providerKind: original.providerKind ?? original.kind ?? null, kind: 'calendar', calendarId, start, end, allDay, dayNotice, title: original.title ?? original.summary ?? '', location: original.location ?? '', status: original.status ?? 'confirmed', isSchool: school.has(calendarId), originalStart: original.originalStartTime ? eventTime(original.originalStartTime, timeZone) : start, sources: [{ calendarId, eventId: original.id ?? null, status: original.status ?? 'confirmed', updated: original.updated ?? null }] });
    } catch (error) { errors.push({ calendarId, eventId: original.id ?? null, reason: error.message }); }
  }
  const groups = new Map(), result = [];
  for (const event of normalized) {
    // Only school calendars are duplicate feeds. Personal events remain independent.
    const signature = event.isSchool ? `${normalizedText(event.title)}|${event.start}|${event.end}|${normalizedText(event.location)}|${event.status}|${event.transparency ?? 'opaque'}` : `${event.calendarId}|${event.id ?? result.length}|${event.start}`;
    // Untitled events without stable identity are never guessed to be duplicates.
    const key = event.isSchool && !normalizedText(event.title) ? `${signature}|${event.iCalUID ?? event.id ?? result.length}` : signature;
    if (groups.has(key)) groups.get(key).sources.push(...event.sources);
    else { groups.set(key, event); result.push(event); }
  }
  const conflicts = [];
  for (let a = 0; a < result.length; a++) for (let b = a + 1; b < result.length; b++) {
    const first = result[a], second = result[b];
    if (!first.isSchool || !second.isSchool) continue;
    const acrossFeeds = first.sources.some(x => second.sources.some(y => x.calendarId !== y.calendarId));
    if (!acrossFeeds) continue;
    const recurring = first.recurringEventId || second.recurringEventId || first.originalStartTime || second.originalStartTime;
    const sameIdentity = first.iCalUID && first.iCalUID === second.iCalUID && (!recurring || first.originalStart === second.originalStart);
    const reviewedMatch = first.reviewedMatchKey && first.reviewedMatchKey === second.reviewedMatchKey;
    const sameTitleOverlap = normalizedText(first.title) && normalizedText(first.title) === normalizedText(second.title) && overlap(first, second);
    if (sameIdentity || reviewedMatch || sameTitleOverlap) conflicts.push({ kind: 'source-disagreement', first: first.id ?? first.sources[0].eventId, second: second.id ?? second.sources[0].eventId, events: [first, second], reason: 'School sources disagree on time, location, status or availability', sources: [...first.sources, ...second.sources], requiresReview: true });
  }
  const busy = result.filter(event => event.status !== 'cancelled' && event.transparency !== 'transparent' && !event.dayNotice);
  const calendarConflicts = [];
  for (let a = 0; a < busy.length; a++) for (let b = a + 1; b < busy.length; b++) {
    const first=busy[a], second=busy[b];
    if (overlap(first,second) && !conflicts.some(c=>c.events.includes(first)&&c.events.includes(second))) calendarConflicts.push({kind:'calendar-overlap',events:[first,second],reason:'Two independent commitments occupy the same time.',requiresReview:true});
  }
  return { events: result.sort((a, b) => instant(a.start) - instant(b.start)), busy, busyIntervals: mergeIntervals(busy), conflicts, sourceConflicts:conflicts, calendarConflicts, errors, ignored, duplicatesRemoved: normalized.length - result.length, incomplete: errors.length > 0 };
}

export function assertPersonalCalendarWrite({ calendarId, personalCalendarId, attendees = [], operation = 'create', existingEvent, intentionalEdit = false }) {
  if (!personalCalendarId || calendarId !== personalCalendarId) throw new Error('Only the configured Personal calendar permits writes');
  if (attendees.length) throw new Error('Calendar writes cannot invite attendees');
  if (!['create', 'update', 'delete'].includes(operation)) throw new Error('Unsupported calendar operation');
  if (operation !== 'create' && !existingEvent?.lifeosManaged && !intentionalEdit) throw new Error('An intentional edit is required to change an existing personal event');
  return { calendarId, sendUpdates: 'none', allowed: true };
}
