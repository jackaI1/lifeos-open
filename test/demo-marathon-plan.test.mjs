import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoMarathonSource, DEMO_MARATHON_GOAL_MINUTES, MILES_TO_KM} from '../demo/marathon-plan.mjs';
import {buildTrainingReference} from '../src/domain/training.mjs';

test('public marathon reference contains all 18 complete weeks with verified attribution', () => {
  const plan = createDemoMarathonSource();
  assert.equal(plan.program, 'Beginner');
  assert.equal(DEMO_MARATHON_GOAL_MINUTES, 240);
  assert.match(plan.source.url, /^https:\/\/hansons-running\.com\//);
  assert.match(plan.source.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.sourceWeeks.map(w => w.week), Array.from({length: 18}, (_, i) => i + 1));
  for (const week of plan.sourceWeeks) {
    assert.deepEqual(week.days.map(d => d.dayOffset), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(week.days.reduce((sum, day) => sum + day.sourceDistanceMiles, 0), week.printedWeeklyTotalMiles);
    assert.ok(Math.abs(week.printedWeeklyTotalKm - week.printedWeeklyTotalMiles * MILES_TO_KM) <= 0.0005);
    for (const day of week.days) {
      assert.equal(day.source.visuallyVerified, true);
      assert.match(day.source.location, /PDF page [1-5], week \d+, /);
      assert.equal(day.units, 'km');
    }
  }
});

test('published mileage includes base, cutbacks, three 16-mile runs and the race-week taper', () => {
  const weeks = createDemoMarathonSource().sourceWeeks;
  assert.deepEqual(weeks.map(w => w.printedWeeklyTotalMiles), [12, 15, 21, 20, 24, 40, 39, 42, 49, 48, 54.5, 50, 56.5, 49, 57.5, 51, 49.5, 50.2]);
  assert.deepEqual(weeks.filter(w => w.days[6].sourceDistanceMiles === 16).map(w => w.week), [11, 13, 15]);
  assert.equal(weeks[16].days[6].kind, 'easy');
  assert.equal(weeks[16].days[6].sourceDistanceMiles, 8);
  assert.equal(weeks[17].days.slice(0, 6).reduce((sum, d) => sum + d.sourceDistanceMiles, 0), 24);
  assert.equal(weeks[17].days[6].kind, 'race');
  assert.equal(weeks[17].days[6].sourceDistanceMiles, 26.2);
  assert.equal(weeks[17].days[6].raceDistanceKm, 42.195);
});

test('quality sessions retain interval progressions, warm-up, cooldown and unresolved recovery count', () => {
  const weeks = createDemoMarathonSource().sourceWeeks;
  assert.deepEqual(weeks.slice(5, 10).map(w => w.days[1].components[1].repetitions), [12, 8, 6, 5, 4]);
  assert.deepEqual(weeks.slice(5, 10).map(w => w.days[1].components[1].repeatDistanceKm), [0.4, 0.6, 0.8, 1, 1.2]);
  assert.deepEqual(weeks.slice(10, 17).map(w => w.days[1].components[1].repetitions), [6, 4, 3, 2, 3, 4, 6]);
  assert.deepEqual(weeks.slice(5, 17).map(w => w.days[3].components[1].sourceDistanceMiles), [5, 5, 5, 8, 8, 8, 9, 9, 9, 10, 10, 10]);
  for (const week of weeks.slice(5, 17)) {
    const session = week.days[1], recovery = session.components.find(c => c.kind === 'recovery');
    assert.equal(session.requiresWarmupCooldown, true);
    assert.deepEqual(session.components.map(c => c.kind), ['warmup', week.week <= 10 ? 'speed' : 'strength', 'recovery', 'cooldown']);
    assert.equal(recovery.distanceKm, null);
    assert.equal(recovery.options.length, 2);
    assert.match(session.source.inconsistency, /unspecified/);
  }
});

test('reference calendar keeps official weekdays, race date and honest review limitations', () => {
  const source = createDemoMarathonSource();
  const plan = buildTrainingReference({raceDate: '2027-02-28', sourceWeeks: source.sourceWeeks, raceExceptionConfirmed: true, sundayRest: false});
  assert.equal(plan.workouts.length, 126);
  assert.equal(plan.firstMonday, '2026-10-26');
  assert.equal(plan.workouts.at(-1).date, '2027-02-28');
  assert.equal(plan.workouts.at(-1).kind, 'race');
  assert.equal(plan.workouts.find(w => w.week === 11 && w.kind === 'long').date, '2027-01-10');
  assert.equal(plan.status, 'source-review-needed');
  assert.ok(plan.issues.some(issue => issue.includes('Recovery after the final repetition is unspecified')));
  assert.ok(plan.workouts.every(w => w.completed === false && w.automaticallyActive === false));
  assert.deepEqual(source.paceProfiles, []);
});

test('each demo workspace receives an independent copy of the source facts', () => {
  const first = createDemoMarathonSource(), second = createDemoMarathonSource();
  first.sourceWeeks[0].days[1].totalDistanceKm = 999;
  first.source.title = 'Changed';
  assert.notEqual(second.sourceWeeks[0].days[1].totalDistanceKm, 999);
  assert.notEqual(second.source.title, 'Changed');
});
