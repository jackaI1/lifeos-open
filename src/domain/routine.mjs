import {practiceDay} from '../../public/devotional-day.js';
import {lifeosDay} from '../../public/lifeos-day.js';
import { DEFAULT_TIME_ZONE, instant, localDate, zonedDateTime, weekday, addDays, addMinutes, availableIntervals, mergeIntervals, minutesBetween, overlap } from './time.mjs';
import { assessSpiritualPlans, schoolReleaseExtension } from './spiritual.mjs';

export const ROUTINE_DEFAULTS = Object.freeze({ spiritualPracticesEnabled: false, timeZone: DEFAULT_TIME_ZONE, wakeTime: '06:30', outOfBedCutoff: '06:45', campusArrivalTime: '08:30', releaseTime: '17:00', bedTime: '22:00', recoveryTime: '20:30', breakfastMinutes: 30, commuteMinutes: 30, lunchMinutes: 45, dinnerMinutes: 60, exerciseMinutes: 60, fridayRunMinutes: 30, showerMinutes: 30, transitionMinutes: 5, focusBlockMinutes: 50, studyBreakMinutes: 10, fridayFellowshipStart: '19:30', fridayFellowshipEnd: '21:30', fridayTravelMinutes: 30, fridayBedTime: '22:30', saturdayWakeTime: '07:00', groceryMinutes: 120 });

/** Feasible blocks only. Unfittable commitments stay visible in conflicts/unscheduled. */
export function buildDayPlan({ date, now, events = [], settings = {}, spiritual = {} }) {
  const config = { ...ROUTINE_DEFAULTS, ...settings, ...(settings.exceptions?.[date] ?? {}) };
  const spiritualPracticesEnabled = config.spiritualPracticesEnabled === true;
  const morningCommuteMinutes = config.morningCommuteMinutes ?? config.commuteMinutes;
  const eveningCommuteMinutes = config.eveningCommuteMinutes ?? config.commuteMinutes;
  for (const key of ['breakfastMinutes', 'commuteMinutes', 'lunchMinutes', 'dinnerMinutes', 'exerciseMinutes', 'fridayRunMinutes', 'showerMinutes', 'transitionMinutes', 'focusBlockMinutes', 'studyBreakMinutes', 'fridayTravelMinutes', 'groceryMinutes']) {
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 720 || key === 'focusBlockMinutes' && config[key] < 1) throw new RangeError(`Invalid routine setting: ${key}`);
  }
  for (const minutes of [morningCommuteMinutes, eveningCommuteMinutes]) if (!Number.isFinite(minutes) || minutes < 0 || minutes > 720) throw new RangeError('Invalid commute duration');
  const day = weekday(date), sunday = day === 0, saturday = day === 6, friday = day === 5;
  const at = time => zonedDateTime(date, time, { timeZone: config.timeZone });
  const dayStart = at('00:00'), dayEnd = zonedDateTime(addDays(date, 1), '05:00', { timeZone: config.timeZone });
  const blocks = [], conflicts = [], unscheduled = [], notes = [];
  const actual = events.filter(e => e.status !== 'cancelled' && e.transparency !== 'transparent' && overlap(e, { start: dayStart, end: dayEnd }));
  for (const event of actual) blocks.push({ ...event, kind: 'calendar', title: event.title || event.summary || 'Untitled calendar event', fixed: true });
  for (let a = 0; a < actual.length; a++) for (let b = a + 1; b < actual.length; b++) if (overlap(actual[a], actual[b])) conflicts.push({ kind: 'calendar-overlap', eventIds: [actual[a].id ?? null, actual[b].id ?? null], message: 'Calendar commitments overlap. Preserve both and review the source details.' });
  const reserve = (kind, title, start, minutes, extra = {}) => {
    if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError(`Invalid duration for ${kind}`);
    if (!minutes) return null;
    const end = addMinutes(start, minutes);
    const collision = blocks.filter(block => overlap(block, { start, end }));
    if (instant(end) > instant(dayEnd) || instant(start) < instant(dayStart) || collision.length) {
      const item = { kind, title, requestedStart: start, requestedEnd: end, minutes, reason: collision.length ? 'conflict' : 'outside-day', conflictsWith: collision.map(b => b.kind) };
      unscheduled.push(item); conflicts.push({ ...item, message: `${title} needs a different time; the plan does not overlap commitments.` });
      return null;
    }
    const item = { kind, title, start, end, minutes, ...extra }; blocks.push(item); return item;
  };
  const flexible = (kind, title, earliest, latest, minutes, extra = {}) => {
    const slot = availableIntervals({ start: earliest, end: latest, busy: blocks, minimumMinutes: minutes })[0];
    if (!slot) { unscheduled.push({ kind, title, minutes, reason: 'insufficient-capacity', earliest, latest }); return null; }
    return reserve(kind, title, slot.start, minutes, extra);
  };
  for(const trip of config.travelBlocks??[])if(overlap(trip,{start:dayStart,end:dayEnd}))reserve('travel',trip.title,trip.start,trip.minutes,{id:trip.id,protected:true,estimated:trip.estimated,location:trip.location,mode:trip.mode,evidence:trip.evidence});
  const wake = at(saturday ? config.saturdayWakeTime : config.wakeTime);
  const bedtime = at(friday ? config.fridayBedTime : config.bedTime);
  reserve('sleep', 'Sleep opportunity', dayStart, minutesBetween(dayStart, wake), { protected: true });
  reserve('sleep', 'Sleep opportunity', bedtime, minutesBetween(bedtime, dayEnd), { protected: true });
  // Keep morning preparation separate from devotional and food preparation.
  let morning = wake;
  reserve('getting-ready', 'Wake up and get ready', morning, 10); morning = addMinutes(morning, 10);
  if (spiritualPracticesEnabled) { reserve('devotional', 'Morning devotional', morning, 30, { plan: 'A', optionalIfComplete: true }); morning = addMinutes(morning, 30); }
  reserve('getting-ready', 'Wash and get ready', morning, 20); morning = addMinutes(morning, 20);
  reserve('breakfast', 'Breakfast and lunch preparation', morning, config.breakfastMinutes, { protected: true }); morning = addMinutes(morning, config.breakfastMinutes);

  const extensionMinutes = !spiritualPracticesEnabled || sunday || saturday ? 0 : schoolReleaseExtension({ date, devotional: spiritual.devotional, timeZone: config.timeZone });
  const release = addMinutes(at(config.releaseTime), extensionMinutes);
  let schoolWindow = null, dinner = null, discretionaryWindow = null;
  if (!sunday && !saturday) {
    const commuteStart = addMinutes(at(config.campusArrivalTime), -morningCommuteMinutes);
    reserve('commute', spiritualPracticesEnabled ? 'Walk to campus and prayer' : 'Walk to campus', commuteStart, morningCommuteMinutes, spiritualPracticesEnabled ? { prayerPlan: 'A', requiresSafeStationaryFinish: morningCommuteMinutes < 15 } : {});
    if (instant(morning) > instant(commuteStart)) notes.push('Morning preparation exceeds the arrival plan. Adjust preparation without overlapping the time.');
    schoolWindow = { start: at(config.campusArrivalTime), end: release };
    flexible('lunch', 'Lunch', at('11:30'), at('14:00'), config.lunchMinutes, { protected: true });
    reserve('commute', 'Walk home', release, eveningCommuteMinutes, spiritualPracticesEnabled ? { prayerPlan: 'C' } : {});
    dinner = reserve('dinner', 'Dinner', addMinutes(release, eveningCommuteMinutes), config.dinnerMinutes, { protected: true });
    if (friday) {
      const outbound = addMinutes(at(config.fridayFellowshipStart), -config.fridayTravelMinutes);
      reserve('travel', 'Travel to fellowship', outbound, config.fridayTravelMinutes);
      reserve('fellowship', 'Fellowship', at(config.fridayFellowshipStart), minutesBetween(at(config.fridayFellowshipStart), at(config.fridayFellowshipEnd)));
      const home = reserve('travel', 'Travel home', at(config.fridayFellowshipEnd), config.fridayTravelMinutes);
      if (home) reserve('shower', 'Final shower and transition', home.end, config.showerMinutes, { roomOnlyAfter: true });
      const start = dinner?.end ?? addMinutes(release, eveningCommuteMinutes + config.dinnerMinutes);
      flexible('exercise', 'Shorter Friday run time', start, outbound, config.fridayRunMinutes, { placeholder: true, trainingPrescription: false });
      notes.push('Friday bedtime and Saturday wake form an editable exception. Training duration must include warm-up and cooldown.');
    } else {
      const start = dinner?.end ?? addMinutes(release, eveningCommuteMinutes + config.dinnerMinutes);
      const exerciseStart = addMinutes(bedtime, -config.exerciseMinutes - config.showerMinutes);
      reserve('exercise', 'Exercise time', exerciseStart, config.exerciseMinutes, { placeholder: true, trainingPrescription: false });
      reserve('shower', 'Final shower and transition', addMinutes(bedtime, -config.showerMinutes), config.showerMinutes, { roomOnlyAfter: true });
      discretionaryWindow = { start, end: exerciseStart };
      if (config.eveningLayout === 'split' && minutesBetween(start, exerciseStart) >= 120) {
        // Move exercise/shower between two discretionary hours; later work stays in the room.
        const exerciseIndex = blocks.findIndex(b => b.kind === 'exercise' && b.start === exerciseStart);
        const showerIndex = blocks.findIndex(b => b.kind === 'shower');
        const removed = [blocks[exerciseIndex], blocks[showerIndex]].filter(Boolean);
        for (const b of removed) blocks.splice(blocks.indexOf(b), 1);
        const splitStart = addMinutes(start, 60);
        reserve('exercise', 'Exercise time', splitStart, config.exerciseMinutes, { placeholder: true, trainingPrescription: false });
        reserve('shower', 'Final shower and transition', addMinutes(splitStart, config.exerciseMinutes), config.showerMinutes, { roomOnlyAfter: true });
        discretionaryWindow = { start, end: bedtime };
      }
    }
  } else if (saturday) {
    if (spiritualPracticesEnabled) reserve('prayer', 'Morning prayer', morning, 15, { plan: 'A' });
    schoolWindow = { start: spiritualPracticesEnabled ? addMinutes(morning, 15) : morning, end: at('12:00'), optional: true };
    flexible('lunch', 'Lunch', at('12:00'), at('13:30'), config.lunchMinutes, { protected: true });
    flexible('groceries', 'Groceries', at('12:00'), at('17:30'), config.groceryMinutes);
    if (config.saturdayRunMinutes != null) flexible('exercise', 'Configured run time including warm-up and cooldown', at('12:00'), at('17:30'), config.saturdayRunMinutes, { trainingPrescription: false });
    else notes.push('Long-run duration is unconfigured. The training baseline must be reviewed before a strenuous plan activates.');
    dinner = reserve('dinner', 'Dinner', at('17:30'), config.dinnerMinutes, { protected: true });
    if (config.saturdayTravelMinutes != null && dinner) reserve('travel', 'Commute home', dinner.end, config.saturdayTravelMinutes);
    else notes.push('Configure the actual commute home after dinner. No travel duration has been assumed.');
    discretionaryWindow = { start: at('12:00'), end: at('17:30') };
  } else {
    if (spiritualPracticesEnabled) reserve('prayer', 'Prayer', morning, 15, { plan: 'A' });
    flexible('lunch', 'Lunch', at('11:30'), at('14:00'), config.lunchMinutes, { protected: true });
    dinner = reserve('dinner', 'Dinner', at('17:30'), config.dinnerMinutes, { protected: true });
    notes.push('Sunday is for church, family, rest and spiritual practices. School planning, projects and exercise are excluded.');
    if (config.sundayReturnTime && config.sundayReturnMinutes != null) reserve('travel', 'Return travel with optional OT Bible study', at(config.sundayReturnTime), config.sundayReturnMinutes, { optionalActivity: 'OT Bible study', activityMinutes: Math.min(90, config.sundayReturnMinutes) });
  }
  // Allocate independent B slots only from actual remaining weekday capacity.
  const campusSlots = [];
  if (spiritualPracticesEnabled && schoolWindow && !saturday) {
    for (const kind of ['devotional', 'prayer']) {
      const state = spiritual[kind],duration=kind==='prayer'?15:30;
      if (state?.complete && (kind==='devotional'||state.completedAt) && practiceDay(state,kind,config.timeZone) === date) continue;
      const candidates = availableIntervals({ ...schoolWindow, busy: [...blocks, ...campusSlots], minimumMinutes: duration });
      const candidate = candidates.find(s => !now || instant(s.end) >= instant(now) + duration * 60_000);
      if (candidate) {
        const start = now && instant(now) > instant(candidate.start) ? new Date(instant(now)).toISOString() : candidate.start;
        campusSlots.push({ kind, start, end: addMinutes(start, duration), plan: 'B' });
      }
    }
  }
  const spiritualPlans = assessSpiritualPlans({ date, now: now ?? wake, devotional: spiritual.devotional, prayer: spiritual.prayer, campusSlots, settings: config });
  // Move proposed practice time, never recorded completion evidence.
  for(const kind of spiritualPracticesEnabled ? ['devotional','prayer'] : []){
    const duration=kind==='prayer'?15:30;const state=spiritualPlans[kind],original=blocks.find(b=>b.kind===kind),current=instant(now??wake);
    if(state.complete){for(let i=blocks.length-1;i>=0;i--)if(blocks[i].kind===kind)blocks.splice(i,1);continue;}
    const missed=original?instant(original.end)<=current:current>=instant(at(config.campusArrivalTime));
    if(!missed||!saturday&&state.plan==='A')continue;
    for(let i=blocks.length-1;i>=0;i--)if(blocks[i].kind===kind)blocks.splice(i,1);
    const phase=saturday?'B':state.plan;
    const earliest=new Date(Math.max(current,instant(saturday?now??wake:phase==='B'?state.slot?.start??now??wake:phase==='D'?at(config.recoveryTime):release))).toISOString();
    // Historical days cannot move unfinished practice into a day that has ended.
    if(instant(earliest)>=instant(dayEnd)){state.slot=null;continue;}
    let candidate=availableIntervals({start:earliest,end:dayEnd,busy:blocks,minimumMinutes:duration})[0];
    if(!candidate&&phase==='D')candidate=availableIntervals({start:earliest,end:dayEnd,busy:blocks.filter(b=>b.kind!=='sleep'),minimumMinutes:duration})[0];
    if(!candidate){state.slot=null;continue;}
    const slot={start:candidate.start,end:addMinutes(candidate.start,duration)};
    // The owner's unfinished daily practices precede bedtime; retain the remaining sleep.
    for(let i=blocks.length-1;i>=0;i--){const b=blocks[i];if(b.kind!=='sleep'||!overlap(b,slot))continue;blocks.splice(i,1);if(instant(b.end)>instant(slot.end))blocks.push({...b,scheduleEntryId:b.scheduleEntryId??'plan:sleep:'+b.start,start:slot.end,minutes:minutesBetween(slot.end,b.end)});}
    const placed=reserve(kind,kind==='devotional'?'Devotional':'Prayer',slot.start,duration,{plan:phase,fallback:true,...(original?{scheduleEntryId:'plan:'+kind+':'+original.start}:{})});
    if(placed){state.plan=phase;state.slot=slot;if(saturday)state.suggestion='Use the next free time between commitments.';}
  }
  const academicWindows = schoolWindow ? availableIntervals({ ...schoolWindow, busy: [...blocks, ...campusSlots, ...actual.filter(e => e.isSchool).map(e => ({ start: addMinutes(e.start, -config.transitionMinutes), end: addMinutes(e.end, config.transitionMinutes) }))], minimumMinutes: 10 }) : [];
  const academicBlocks = [];
  for (const window of academicWindows) {
    let cursor = window.start;
    while (minutesBetween(cursor, window.end) >= 10) {
      const duration = Math.min(config.focusBlockMinutes, minutesBetween(cursor, window.end));
      academicBlocks.push({ start: cursor, end: addMinutes(cursor, duration), minutes: duration });
      cursor = addMinutes(cursor, duration + config.studyBreakMinutes);
    }
  }
  const availableEvening = discretionaryWindow && instant(discretionaryWindow.end) > instant(discretionaryWindow.start) ? availableIntervals({ ...discretionaryWindow, busy: blocks, minimumMinutes: 5 }).map(i => ({ ...i, roomOnly: blocks.some(b => b.kind === 'shower' && instant(b.end) <= instant(i.start)) })) : [];

  return { date, spiritualPracticesEnabled, dayType: sunday ? 'sunday' : saturday ? 'saturday' : friday ? 'friday' : 'weekday', timeZone: config.timeZone, blocks: blocks.sort((a, b) => instant(a.start) - instant(b.start)), calendarEvents: actual, conflicts, unscheduled, notes, schoolWindow, academicBlocks, academicMinutes: academicBlocks.reduce((sum, b) => sum + b.minutes, 0), academicAllowed: !sunday, academicOptional: saturday, discretionaryBlocks: availableEvening, discretionaryMinutes: availableEvening.reduce((sum, b) => sum + b.minutes, 0), ticketEvening: day >= 1 && day <= 4, campusSlots, spiritual: spiritualPlans, releaseAt: sunday || saturday ? null : release, extensionMinutes, sleepOpportunityMinutes: minutesBetween(bedtime, zonedDateTime(addDays(date, 1), friday ? config.saturdayWakeTime : config.wakeTime, { timeZone: config.timeZone })) };
}

export function academicAutomationAllowed({ now, settings = {} }) {
  const { timeZone = DEFAULT_TIME_ZONE } = settings;
  const date = lifeosDay(now,timeZone);
  const day = weekday(date);
  if (day === 0) return false;
  const start = zonedDateTime(date, settings.academicSyncStart ?? '08:15', { timeZone });
  const end = zonedDateTime(date, day === 6 ? settings.saturdayAcademicEnd ?? '12:00' : settings.academicSyncEnd ?? '17:30', { timeZone });
  return instant(now) >= instant(start) && instant(now) < instant(end);
}
