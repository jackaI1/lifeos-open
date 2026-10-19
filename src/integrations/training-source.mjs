import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const rounded = n => Math.round(n * 1000) / 1000;
const distanceKm = (number, units) => Number(number) / (units.toLowerCase() === 'm' ? 1000 : 1);

/** Parse an already visually checked cell. Unknown notation stays unknown. */
export function parseTrainingCell({ raw, dayOffset, source, componentNotes = {} }) {
  if (typeof raw !== 'string' || raw.length > 5000 || !Number.isInteger(dayOffset) || dayOffset < 0 || dayOffset > 6) throw new TypeError('A bounded table cell and weekday are required');
  const text = raw.replace(/\s+/g, ' ').trim(), issues = [];
  const item = { dayOffset, sourceText: raw, units: 'km', kind: 'unknown', totalDistanceKm: null, components: [], requiresWarmupCooldown: false, source: { ...source }, interpretationIssues: issues };
  if (/^(OFF|REST)$/i.test(text)) return { ...item, kind: 'rest', totalDistanceKm: 0 };
  if (/^[-—–]$/.test(text)) { issues.push('The source cell is a dash, not an explicit rest instruction.'); }
  else if (/^RACE!?$/i.test(text)) { item.kind = 'race'; issues.push('Race distance is not printed in this cell. Use separately confirmed race information.'); }
  else {
    const simple = text.match(/^(Easy|Long|Tempo)\s+(\d+(?:\.\d+)?)\s*km$/i);
    const repeats = text.match(/^(Speed|Strength)\s+(\d+)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(km|m)\s+(\d+(?:\.\d+)?)\s*(km|m)\s+rec\.?$/i);
    if (simple) {
      item.kind = simple[1].toLowerCase(); const distance = Number(simple[2]);
      item.components.push({ kind: item.kind, distanceKm: distance, source: 'table-cell' });
      if (item.kind !== 'tempo') item.totalDistanceKm = distance;
    } else if (repeats) {
      item.kind = repeats[1].toLowerCase(); const repetitions = Number(repeats[2]);
      if (repetitions < 1 || repetitions > 100) throw new RangeError('Repeat count is invalid');
      const repeatDistanceKm = distanceKm(repeats[3], repeats[4]), recoveryDistanceKm = distanceKm(repeats[5], repeats[6]);
      item.components.push({ kind: item.kind, repetitions, repeatDistanceKm, distanceKm: rounded(repetitions * repeatDistanceKm), source: 'table-cell' });
      item.components.push({ kind: 'recovery', repeatDistanceKm: recoveryDistanceKm, repetitions: null, distanceKm: null, options: [{ repetitions: repetitions - 1, distanceKm: rounded((repetitions - 1) * recoveryDistanceKm) }, { repetitions, distanceKm: rounded(repetitions * recoveryDistanceKm) }], source: 'recovery-count-unspecified' });
      issues.push('The cell gives a recovery distance but does not state whether recovery follows the final repeat.');
    } else issues.push('Cell notation is not recognized. Preserve the source and review it.');
  }
  if (['speed', 'strength', 'tempo'].includes(item.kind)) {
    item.requiresWarmupCooldown = true;
    for (const kind of ['warmup', 'cooldown']) {
      const part = { kind, distanceKm: null, source: 'conflicting-source-notes', sourceAlternatives: componentNotes[kind] ?? [] };
      if (kind === 'warmup') item.components.unshift(part); else item.components.push(part);
    }
    issues.push('Warm-up and cooldown values require source review. No conflicting value was silently selected.');
  }
  if (issues.length) item.source.inconsistency = issues.join(' ');
  return item;
}

/** Caller supplies private source rows, never a schedule embedded in public code. */
export function normalizeTrainingSource({ program, rows, source, componentNotes = {}, notes = [] }) {
  if (program !== 'Beginner') throw new Error('Only the requested Beginner table may be imported');
  if (!Array.isArray(rows) || !rows.length || rows.length > 60) throw new Error('Source rows are required');
  if (!source?.id || !source?.sha256 || !source?.url) throw new Error('Source identity and fingerprint are required');
  const seen = new Set(), issues = [], sourceWeeks = [];
  for (const row of rows) {
    if (!Number.isInteger(row.week) || row.week < 1 || seen.has(row.week)) throw new Error('Source week numbers must be unique positive integers');
    if (!Number.isInteger(row.page) || row.page < 1 || !Array.isArray(row.cells) || row.cells.length !== 7) throw new Error('Each source week requires a page and exactly seven cells');
    seen.add(row.week);
    const days = row.cells.map((raw, dayOffset) => parseTrainingCell({ raw, dayOffset, componentNotes, source: { ...source, location: `Table 4.3, page ${row.page}, week ${row.week}, ${dayNames[dayOffset]}`, page: row.page, visuallyVerified: row.visuallyVerified === true } }));
    const total = String(row.weeklyTotal).match(/^(\d+(?:\.\d+)?)\s*km$/i);
    const printedWeeklyTotalKm = total ? Number(total[1]) : null;
    const allKnown = days.every(d => d.totalDistanceKm !== null);
    const computedKnownDistanceKm = rounded(days.reduce((n, d) => n + (d.totalDistanceKm ?? d.components.filter(p => ['easy', 'long', 'speed', 'strength', 'tempo'].includes(p.kind)).reduce((k, p) => k + (p.distanceKm ?? 0), 0)), 0));
    const weekIssues = [];
    if (!row.visuallyVerified) weekIssues.push('Table row has not been visually verified.');
    if (printedWeeklyTotalKm === null) weekIssues.push('Printed weekly total is unknown.');
    if (allKnown && printedWeeklyTotalKm !== null && Math.abs(printedWeeklyTotalKm - computedKnownDistanceKm) > 0.05) weekIssues.push('Printed weekly total differs from the sum of source cells; both values are preserved.');
    if (!allKnown) weekIssues.push('Weekly distance cannot be verified while components or dash/race cells remain unresolved.');
    sourceWeeks.push({ week: row.week, days, printedWeeklyTotal: row.weeklyTotal, printedWeeklyTotalKm, computedKnownDistanceKm, computedTotalKm: allKnown ? computedKnownDistanceKm : null, sourceIssues: weekIssues, sourceRowHash: hash(JSON.stringify(row)), originalRow: row });
    issues.push(...weekIssues.map(issue => `Week ${row.week}: ${issue}`));
  }
  return { schemaVersion: 1, program, source: { ...source }, notes, componentNotes, sourceWeeks: sourceWeeks.sort((a, b) => a.week - b.week), issues, status: issues.length ? 'source-review-needed' : 'reference-ready', personalized: false, automaticCatchUp: false, completed: false, adaptation: null };
}

/** Compare explicit alternatives without choosing or changing the source plan. */
export function compareTrainingComponents(week, { warmupKm, cooldownKm, recoveryAfterFinalRepeat = false, raceDistanceKm = null }) {
  if (![warmupKm, cooldownKm].every(x => Number.isFinite(x) && x >= 0)) throw new RangeError('Explicit warm-up and cooldown alternatives are required');
  let total = 0; const unresolved = [];
  for (const day of week.days) {
    if (day.kind === 'race') { if (raceDistanceKm !== null && Number.isFinite(raceDistanceKm) && raceDistanceKm > 0) total += raceDistanceKm; else unresolved.push('Race distance'); continue; }
    if (day.kind === 'unknown') { unresolved.push(day.sourceText); continue; }
    for (const component of day.components) {
      if (component.kind === 'warmup') total += warmupKm;
      else if (component.kind === 'cooldown') total += cooldownKm;
      else if (component.kind === 'recovery') total += component.options[recoveryAfterFinalRepeat ? 1 : 0].distanceKm;
      else if (component.distanceKm !== null) total += component.distanceKm;
      else unresolved.push(component.kind);
    }
  }
  return { computedDistanceKm: unresolved.length ? null : rounded(total), printedWeeklyTotalKm: week.printedWeeklyTotalKm, differenceKm: unresolved.length || week.printedWeeklyTotalKm === null ? null : rounded(total - week.printedWeeklyTotalKm), unresolved, assumptions: { warmupKm, cooldownKm, recoveryAfterFinalRepeat, raceDistanceKm }, sourceChanged: false, trainingPrescription: false };
}
