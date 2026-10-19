import {practiceDay} from '../../public/devotional-day.js';
import {capacityWarning,dayCarryForward} from './planning-insights.mjs';
import {lifeosDay,nextLifeosDayAt} from '../../public/lifeos-day.js';
import {interpretToday} from './today.mjs';
export {interpretToday} from './today.mjs';
export * from './time.mjs';
export * from './calendar.mjs';
export * from './spiritual.mjs';
export * from './presence.mjs';
export * from './routine.mjs';
export * from './tickets.mjs';
export * from './school.mjs';
export * from './training.mjs';
export * from './defaults.mjs';

import { DEFAULT_TIME_ZONE, localDate, instant, validDate, zonedDateTime } from './time.mjs';
import { normalizeCalendars } from './calendar.mjs';
import { buildDayPlan } from './routine.mjs';
import { derivePresenceLedger } from './presence.mjs';
import { ticketBalance, suggestTicketSessions } from './tickets.mjs';
import { rankSchoolTasks } from './school.mjs';
import { assessTraining } from './training.mjs';

const data = records => (records ?? []).map(record => ({ ...(record.data ?? record), id: record.id, version: record.version, createdAt: record.createdAt ?? record.data?.createdAt, updatedAt: record.updatedAt ?? record.data?.updatedAt }));

export function normalizeDomainSettings(settings = {}) {
  const config = { ...settings };
  const aliases = { timezone: 'timeZone', lightsOut: 'bedTime', lateRounding: 'latenessRounding', schoolStart: 'campusArrivalTime', schoolEnd: 'releaseTime', fridayBedtime: 'fridayBedTime' };
  for (const [from, to] of Object.entries(aliases)) if (settings[from] != null && settings[to] == null) config[to] = settings[from];
  const numeric = ['breakfastMinutes', 'lunchPrepMinutes', 'morningCommuteMinutes', 'eveningCommuteMinutes', 'dinnerMinutes', 'fridayTravelMinutes'];
  for (const key of numeric) if (config[key] != null && config[key] !== '') config[key] = Number(config[key]);
  if (config.lunchPrepMinutes != null) config.breakfastMinutes = (config.breakfastMinutes ?? 15) + config.lunchPrepMinutes;
  if (settings.exceptions) config.exceptions = Object.fromEntries(Object.entries(settings.exceptions).map(([date, value]) => [date, normalizeDomainSettings(value)]));
  return config;
}

export function normalizeTrainingRecord(record = {}, timeZone = DEFAULT_TIME_ZONE) {
  const number = value => value === '' || value == null ? undefined : Number(value);
  const boolean = value => typeof value === 'boolean' ? value : ['none', 'no', 'false'].includes(value) ? false : ['yes', 'true'].includes(value) ? true : undefined;
  const baseline = record.baseline ?? {
    recentWeeklyKm: number(record.weeklyKm), longestRecentRunKm: number(record.longestKm), pain: boolean(record.pain), injury: boolean(record.injury), recoveryStatus: record.recovery || undefined,
    guidanceReviewed: record.guidanceReviewed === true || typeof record.guidance === 'string' && record.guidance.trim().length > 0 && !/^(none|unknown|pending|no)$/i.test(record.guidance.trim()),
    recordedAt: validDate(record.baselineDate) ? zonedDateTime(record.baselineDate, '00:00', { timeZone }) : record.baselineDate || undefined,
    activationConfirmed: record.activationConfirmed === true
  };
  return { ...record, baseline, raceDate: record.raceDate || null, raceExceptionConfirmed: record.raceExceptionConfirmed ?? record.sundayExceptionConfirmed ?? false };
}

/** Call only with server-created presence records, never unchecked client JSON. */
export function normalizePresenceRecord(record) {
  const selfReported = record.evidence === 'self-reported';
  return { ...record, occurredAt: record.occurredAt ?? record.timestamp ?? record.observedAt, type: record.type ?? record.event, source: selfReported ? 'manual' : record.source, authenticated: record.authenticated === true || record.trusted === true || selfReported };
}

export function buildToday({ now, records = {}, events = [], settings = {}, jobs = [], date = null }) {
  const storedSettings = data(records.settings).reduce((all, record) => ({ ...all, ...record }), {});
  const config = normalizeDomainSettings({ ...storedSettings, ...settings });
  date ??= lifeosDay(now,config.timeZone??DEFAULT_TIME_ZONE);
  const states = data(records.spiritual).filter(record => practiceDay(record,undefined,config.timeZone) === date);
  const spiritual = {};
  for (const kind of ['devotional', 'prayer']) {
    const candidates=states.filter(record => record.kind === kind || record.practice === kind);
    const state = candidates.filter(r=>r.complete).sort((a,b)=>String(a.completedAt??'').localeCompare(String(b.completedAt??'')))[0] ?? candidates.at(-1) ?? {};
    spiritual[kind] = { ...state, completedAt: state.completedAt ?? state.observedAt ?? null };
  }
  const calendar = normalizeCalendars({ events, allowedCalendarIds: config.allowedCalendarIds ?? [], schoolCalendarIds: config.schoolCalendarIds ?? [], timeZone: config.timeZone });
  const plan = buildDayPlan({ date, now, events: calendar.busy, settings: config, spiritual });
  // These slots already reduce academic capacity. Show them in the same timeline
  // so a current campus practice cannot disappear behind a later meal or task.
  plan.blocks.push(...plan.campusSlots.map(slot => ({ ...slot, title: slot.kind === 'devotional' ? 'Campus devotional' : 'Campus prayer', minutes: slot.kind==='prayer'?15:30, fallback: true })));
  plan.blocks.sort((a, b) => instant(a.start) - instant(b.start));
  const ticketLedger = data(records['ticket-spend']);
  const tickets = ticketBalance({ date, ledger: ticketLedger, timeZone: config.timeZone, availableMinutes: plan.discretionaryMinutes });
  const nextDayAt=nextLifeosDayAt(now,config.timeZone);
  const school = rankSchoolTasks({ tasks: data(records.task), now, capacity: [...plan.academicBlocks,...(config.academicCapacity??[]).filter(b=>instant(b.start)>=nextDayAt)], settings: config, activeTaskId: config.activeTaskId, energy: config.energy });
  const academicRanked=(school.ranked.length?school:rankSchoolTasks({tasks:data(records.task),now,capacity:[],settings:config,respectSchoolDay:false})).ranked;
  const academicNext=academicRanked.find(t=>!t.blocked)??null;
  const trainingRecords=data(records.training);
  const training = normalizeTrainingRecord(trainingRecords.find(record=>record.id==='baseline')??trainingRecords[0]??{}, config.timeZone);
  const presence=derivePresenceLedger({ date, events: data(records.presence).map(normalizePresenceRecord), corrections: [...(config.presenceCorrections ?? []),...data(records['presence-correction'])], settings: config, prayer: spiritual.prayer });
  const interpreted=interpretToday({now,date,plan,calendar,school,tickets,records,presence,settings:{...config,...config.exceptions?.[date]},jobs});
  return { date, now, capacityWarning:capacityWarning(data(records.task),[...plan.academicBlocks,...(config.academicCapacity??[]).filter(b=>instant(b.start)>=nextDayAt)],now,config.timeZone),carryForward:dayCarryForward(data(records.task),date,config.timeZone), ...plan, schedule: plan.blocks, availability: { academicMinutes: plan.academicMinutes, discretionaryMinutes: plan.discretionaryMinutes, currentBlock: school.availableBlock, academicBlocks: plan.academicBlocks, discretionaryBlocks: plan.discretionaryBlocks }, calendar, tickets, ticketSuggestions: suggestTicketSessions({ date, ledger: ticketLedger, intervals: plan.discretionaryBlocks, timeZone: config.timeZone }), presence, school, academicNext, academicRanked, nextTask: school.next, training: assessTraining({ baseline: training.baseline, now, raceDate: training.raceDate, raceExceptionConfirmed: training.raceExceptionConfirmed, requestedAdaptation: training.requestedAdaptation }), ...interpreted, nextTransition:interpreted.upcoming, nextAction:interpreted.nowAction, conflicts:[...interpreted.calendarConflicts,...interpreted.sourceConflicts] };
}
