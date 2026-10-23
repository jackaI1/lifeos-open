// Public numerical reference, independently checked against the publisher's PDF.
// No owner records, source artwork, book text, or private training data are used.
export const DEMO_MARATHON_GOAL_MINUTES = 240;
export const MILES_TO_KM = 1.609344;
const km = miles => Math.round(miles * MILES_TO_KM * 1000) / 1000;
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const HANSONS_BEGINNER_SOURCE = Object.freeze({
  id: 'hansons-public-beginner-marathon',
  title: 'Hansons Coaching Services · Beginner Marathon',
  url: 'https://hansons-running.com/content/training-plans',
  documentUrl: 'https://s3.us-central-1.wasabisys.com/hansons/Beginner_Marathon_-_new.pdf',
  sha256: 'f31f97ef885bef2dacc2f5053bb0fbad8758d724b8cb857c9cb30fd590086beb',
  checkedOn: '2026-10-22',
  verification: 'All six PDF pages rendered locally and visually inspected; schedule on pages 1–5, pace key on page 6.',
  originalUnits: 'miles, with metric interval distances where printed',
  attribution: 'Numerical workout reference from the free Hansons Beginner Marathon plan. The fictional demo runner and goal are LifeOS examples.',
});

// Mon–Sun published daily mile totals. Zero means a printed rest/cross-training
// cell (race-week Wednesday is rest). Keep cutback weeks and printed rounding.
const dailyMiles = [
  [0, 2, 0, 3, 0, 3, 4],
  [0, 2, 0, 3, 3, 3, 4],
  [0, 4, 0, 4, 4, 4, 5],
  [0, 5, 0, 3, 3, 5, 4],
  [0, 5, 0, 4, 5, 4, 6],
  [4, 9, 0, 7, 4, 8, 8],
  [4, 8, 0, 7, 4, 6, 10],
  [6, 8, 0, 7, 5, 6, 10],
  [5, 8, 0, 10, 6, 5, 15],
  [7, 8, 0, 10, 5, 8, 10],
  [5, 10.5, 0, 10, 5, 8, 16],
  [5, 11, 0, 11, 5, 8, 10],
  [7, 10.5, 0, 11, 6, 6, 16],
  [5, 10, 0, 11, 5, 8, 10],
  [7, 10.5, 0, 12, 6, 6, 16],
  [5, 11, 0, 12, 5, 8, 10],
  [7, 10.5, 0, 12, 6, 6, 8],
  [5, 5, 0, 6, 5, 3, 26.2],
];
const weeklyMiles = [12, 15, 21, 20, 24, 40, 39, 42, 49, 48, 54.5, 50, 56.5, 49, 57.5, 51, 49.5, 50.2];
// week: repetitions, repeat distance, repeat unit, recovery distance, recovery unit
const intervals = {
  6: [12, 400, 'm', 400, 'm'],
  7: [8, 600, 'm', 400, 'm'],
  8: [6, 800, 'm', 400, 'm'],
  9: [5, 1000, 'm', 400, 'm'],
  10: [4, 1200, 'm', 400, 'm'],
  11: [6, 1, 'mi', 400, 'm'],
  12: [4, 1.5, 'mi', 800, 'm'],
  13: [3, 2, 'mi', 800, 'm'],
  14: [2, 3, 'mi', 1, 'mi'],
  15: [3, 2, 'mi', 800, 'm'],
  16: [4, 1.5, 'mi', 800, 'm'],
  17: [6, 1, 'mi', 400, 'm'],
};
const intervalKm = (distance, units) => units === 'mi' ? km(distance) : distance / 1000;
const pageFor = week => week <= 4 ? 1 : week <= 8 ? 2 : week <= 12 ? 3 : week <= 16 ? 4 : 5;

function workout(week, dayOffset, miles) {
  const source = {
    ...HANSONS_BEGINNER_SOURCE,
    location: `PDF page ${pageFor(week)}, week ${week}, ${days[dayOffset]}`,
    page: pageFor(week),
    visuallyVerified: true,
  };
  const item = {dayOffset, units: 'km', sourceDistanceMiles: miles, totalDistanceKm: km(miles), components: [], source};
  if (miles === 0) return {...item, kind: 'rest', description: week === 18 ? 'Rest' : 'Rest or optional cross-training'};
  if (week === 18 && dayOffset === 6) return {...item, kind: 'race', description: 'Fictional marathon race day', raceDistanceKm: 42.195, components: [{kind: 'race', distanceKm: km(miles)}], distanceNote: 'The source prints the rounded marathon distance of 26.2 miles; the race distance is 42.195 km.'};
  if (week >= 6 && week <= 17 && dayOffset === 1) {
    const [repetitions, distance, unit, recovery, recoveryUnit] = intervals[week];
    const kind = week <= 10 ? 'speed' : 'strength', repeatDistanceKm = intervalKm(distance, unit), recoveryDistanceKm = intervalKm(recovery, recoveryUnit);
    const paceBasis = kind === 'speed' ? '5k–10k race pace' : 'Marathon goal pace minus 10 seconds per mile';
    // The table does not specify recovery after the last repetition, and its
    // printed daily totals are rounded. Never invent a count to force a match.
    source.inconsistency = 'Printed session mileage is rounded. Recovery after the final repetition is unspecified; both component alternatives are retained.';
    return {...item, kind, requiresWarmupCooldown: true, paceBasis, description: `${repetitions} × ${distance} ${unit} with ${recovery} ${recoveryUnit} jog recoveries`, components: [
      {kind: 'warmup', distanceKm: km(1.5), sourceDistanceMiles: 1.5},
      {kind, repetitions, repeatDistanceKm, distanceKm: Math.round(repetitions * repeatDistanceKm * 1000) / 1000, paceBasis},
      {kind: 'recovery', repeatDistanceKm: recoveryDistanceKm, repetitions: null, distanceKm: null, options: [repetitions - 1, repetitions].map(count => ({repetitions: count, distanceKm: Math.round(count * recoveryDistanceKm * 1000) / 1000}))},
      {kind: 'cooldown', distanceKm: km(1.5), sourceDistanceMiles: 1.5},
    ]};
  }
  if (week >= 6 && week <= 17 && dayOffset === 3) return {...item, kind: 'tempo', requiresWarmupCooldown: true, paceBasis: 'Marathon goal pace', description: `${miles - 2} mi at marathon goal pace, plus warm-up and cooldown`, components: [
    {kind: 'warmup', distanceKm: km(1), sourceDistanceMiles: 1},
    {kind: 'tempo', distanceKm: km(miles - 2), sourceDistanceMiles: miles - 2, paceBasis: 'Marathon goal pace'},
    {kind: 'cooldown', distanceKm: km(1), sourceDistanceMiles: 1},
  ]};
  const kind = dayOffset === 6 && week >= 7 && week <= 16 ? 'long' : 'easy';
  return {...item, kind, description: `${miles} mi ${kind} run`, components: [{kind, distanceKm: km(miles), sourceDistanceMiles: miles}]};
}

/** A fresh public reference for each workspace; no fabricated completion data. */
export function createDemoMarathonSource() {
  return {
    schemaVersion: 1,
    program: 'Beginner',
    source: {...HANSONS_BEGINNER_SOURCE},
    sourceWeeks: dailyMiles.map((row, index) => ({
      week: index + 1,
      printedWeeklyTotal: `${weeklyMiles[index]} mi`,
      printedWeeklyTotalMiles: weeklyMiles[index],
      printedWeeklyTotalKm: km(weeklyMiles[index]),
      computedTotalKm: km(row.reduce((sum, miles) => sum + miles, 0)),
      days: row.map((miles, dayOffset) => workout(index + 1, dayOffset, miles)),
    })),
    // The PDF requires a separate pace calculator. An aspirational demo finish
    // time does not establish an easy, long, or 5k pace for a real runner.
    paceProfiles: [],
    notes: [
      'Official 18-week numerical reference. Monday-to-Sunday layout retained, including Sunday long runs and the final race.',
      'Display distances convert the printed mile totals to kilometres; original miles and interval units remain available.',
      'Interval recovery count and rounded source mileage remain explicit source limitations. No pace prescription or completion is invented.',
    ],
    personalized: false,
    automaticCatchUp: false,
    completed: false,
    adaptation: null,
  };
}
