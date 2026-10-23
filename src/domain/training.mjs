import {sundayRestWeeks} from './training-display.mjs';
import { addDays, weekStart, weekday, validDate, instant } from './time.mjs';

export function goalPace({ finishMinutes, distanceKm = 42.195 }) {
  if (!Number.isFinite(finishMinutes) || finishMinutes <= 0 || !Number.isFinite(distanceKm) || distanceKm <= 0) throw new RangeError('Positive goal time and distance are required');
  const secondsPerKm = finishMinutes * 60 / distanceKm;
  const rounded = Math.round(secondsPerKm);
  return { distanceKm, finishMinutes, secondsPerKm, display: `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}/km`, aspirational: true, trainingPacePrescription: false };
}

export function assessTraining({ baseline, now, raceDate = null, raceExceptionConfirmed = false, requestedAdaptation = false }) {
  if (raceDate !== null && !validDate(raceDate)) throw new RangeError('The race date must be a valid date or unconfigured');
  const missing = [];
  if (!baseline || !Number.isFinite(baseline.recentWeeklyKm) || baseline.recentWeeklyKm < 0) missing.push('Actual recent weekly running distance');
  if (!baseline || !Number.isFinite(baseline.longestRecentRunKm) || baseline.longestRecentRunKm < 0) missing.push('Longest recent run');
  if (typeof baseline?.pain !== 'boolean' || typeof baseline?.injury !== 'boolean' || !baseline?.recoveryStatus) missing.push('Current pain, injury and recovery status');
  if (!baseline?.recordedAt) missing.push('When this baseline was reported');
  let stale = false;
  if (baseline?.recordedAt) {
    try { stale = instant(now) - instant(baseline.recordedAt) > 14 * 86_400_000 || instant(baseline.recordedAt) > instant(now) + 5 * 60_000; } catch { stale = true; }
    if (stale) missing.push('An updated recent baseline');
  }
  const healthConcern = baseline?.pain === true || baseline?.injury === true || ['poor', 'exhausted', 'ill'].includes(baseline?.recoveryStatus);
  const needsGuidance = requestedAdaptation && !baseline?.guidanceReviewed;
  if (needsGuidance) missing.push('Appropriate coaching or clinical guidance for the requested strenuous adaptation');
  const sundayConflict = Boolean(raceDate && validDate(raceDate) && weekday(raceDate) === 0 && !raceExceptionConfirmed);
  const canActivateStrenuous = !missing.length && !healthConcern && baseline?.activationConfirmed === true;
  return { status: healthConcern ? 'needs-recovery-review' : missing.length ? 'baseline-needed' : baseline?.activationConfirmed !== true ? 'awaiting-activation' : 'ready-for-reviewed-plan', canActivateStrenuous, moduleAvailable: true, missing, healthConcern, stale, sundayConflict, raceException: sundayConflict ? 'pending-confirmation' : raceDate && weekday(raceDate) === 0 ? 'confirmed-one-off' : 'not-required', automaticCatchUp: false, message: healthConcern ? 'Log symptoms and recovery. Strenuous changes stay inactive until appropriate review.' : missing.length ? 'The calendar and run log are available. Complete the baseline before strenuous training activates.' : baseline?.activationConfirmed ? 'The reported baseline permits review of an active plan. Elapsed source weeks remain uncompleted.' : 'A reviewed plan requires explicit activation; elapsed weeks are not completed training.' };
}

/** Retain original source weeks. There is no automatic volume adaptation or catch-up. */
export function buildTrainingReference({ raceDate, sourceWeeks = [], program = 'Beginner', raceExceptionConfirmed = false, sundayRest = false }) {
  if(sundayRest)sourceWeeks=sundayRestWeeks(sourceWeeks);
  if (!validDate(raceDate)) throw new RangeError('A confirmed race date is required');
  if (program !== 'Beginner') throw new Error('The configured source program must be Beginner');
  if (!sourceWeeks.length) return { workouts: [], issues: ['The verified Beginner source table has not been imported.'], status: 'source-needed', raceDate };
  const weekNumbers = sourceWeeks.map(week => week.week);
  if (weekNumbers.some(week => !Number.isInteger(week) || week < 1) || new Set(weekNumbers).size !== weekNumbers.length) throw new Error('Source week numbering must be unique positive integers');
  const length = Math.max(...weekNumbers), firstMonday = addDays(weekStart(raceDate), -(length - 1) * 7);
  const issues = [], workouts = [];
  for (let week = 1; week <= length; week++) if (!weekNumbers.includes(week)) issues.push(`Source week ${week} is missing; it has not been invented.`);
  for (const sourceWeek of sourceWeeks) for (const item of sourceWeek.days ?? []) {
    if (!Number.isInteger(item.dayOffset) || item.dayOffset < 0 || item.dayOffset > 6) { issues.push(`Week ${sourceWeek.week} contains an invalid source weekday.`); continue; }
    const date = addDays(firstMonday, (sourceWeek.week - 1) * 7 + item.dayOffset);
    const itemIssues = [];
    if (item.units !== 'km' && item.kind !== 'rest') itemIssues.push('Metric units need verification.');
    if (!item.source?.location || item.source?.visuallyVerified !== true) itemIssues.push('Source table location and visual verification are required.');
    if (item.source?.inconsistency) itemIssues.push(item.source.inconsistency);
    const componentKm = (item.components ?? []).reduce((sum, component) => sum + (Number.isFinite(component.distanceKm) ? component.distanceKm : 0), 0);
    if (item.totalDistanceKm != null && componentKm && Math.abs(componentKm - item.totalDistanceKm) > 0.05) itemIssues.push('The component sum disagrees with the source total. Both values are preserved.');
    workouts.push({ ...item, date, week: sourceWeek.week, program, status: 'reference-only', completed: false, automaticallyActive: false, sundayRestConflict: sundayRest && weekday(date) === 0 && item.kind !== 'rest' && !(date === raceDate && raceExceptionConfirmed), sourceIssues: itemIssues, adaptation: null });
    issues.push(...itemIssues.map(issue => `${date}: ${issue}`));
  }
  return { raceDate, firstMonday, program, weeks: length, workouts: workouts.sort((a, b) => a.date.localeCompare(b.date)), issues, status: issues.length ? 'source-review-needed' : 'reference-ready', automaticCatchUp: false, secondRaceDate: null };
}

export function calculateWorkoutDuration({ workout, availableMinutes = null }) {
  const components = [], issues = [];
  if (!Array.isArray(workout?.components) || !workout.components.length) return { minutes: null, components: [], issues: ['Workout components are missing.'], exceedsCapacity: null, paceWasIncreased: false };
  for (const part of workout.components) {
    let minutes = null;
    if (Number.isFinite(part.durationMinutes) && part.durationMinutes >= 0) minutes = part.durationMinutes;
    else if (Number.isFinite(part.distanceKm) && part.distanceKm >= 0 && Number.isFinite(part.paceSecondsPerKm) && part.paceSecondsPerKm > 0) minutes = part.distanceKm * part.paceSecondsPerKm / 60;
    if (minutes === null) issues.push(`Duration or a suitable pace is missing for ${part.kind ?? 'a workout component'}.`);
    components.push({ ...part, minutes });
  }
  for (const kind of ['warmup', 'cooldown']) if (workout.requiresWarmupCooldown === true && !components.some(part => part.kind === kind)) issues.push(`The ${kind} component is missing.`);
  const overheadMinutes = (workout.preparationMinutes ?? 0) + (workout.travelMinutes ?? 0);
  if (!Number.isFinite(overheadMinutes) || overheadMinutes < 0) throw new RangeError('Workout overhead must be nonnegative');
  const minutes = issues.length ? null : components.reduce((sum, part) => sum + part.minutes, 0) + overheadMinutes;
  return { minutes, components, overheadMinutes, issues, availableMinutes, exceedsCapacity: minutes === null || availableMinutes === null ? null : minutes > availableMinutes, excessMinutes: minutes === null || availableMinutes === null ? null : Math.max(0, minutes - availableMinutes), paceWasIncreased: false, message: minutes !== null && availableMinutes !== null && minutes > availableMinutes ? 'This session exceeds the available time. Keep its pace and full components; revise the schedule or obtain a reviewed adaptation.' : null };
}

export function trainingDayAllowed({ date, raceDate, raceExceptionConfirmed = false }) {
  return weekday(date) !== 0 || (date === raceDate && raceExceptionConfirmed === true);
}

export function updateFutureTrainingGoal({ workouts = [], finishMinutes, distanceKm = 42.195 }) {
  const goal = goalPace({ finishMinutes, distanceKm });
  return workouts.map(workout => workout.completed === true || workout.status === 'complete' ? { ...workout } : { ...workout, aspirationalGoal: goal, automaticLoadIncrease: false });
}
