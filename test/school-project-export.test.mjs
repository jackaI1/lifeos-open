import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildSchoolProjectXml, xmlText} from '../src/domain/school-project.mjs';
import {scenarioRecords} from '../demo/scenarios.mjs';

const NOW = '2026-10-06T14:00:00.000Z';
const NS = 'http://schemas.microsoft.com/project';

// Splits the XML into one string per <Task> block so each task's fields can be checked alone.
function tasksOf(xml) {
  return [...xml.matchAll(/<Task>([\s\S]*?)<\/Task>/g)].map(match => match[1]);
}
const field = (block, name) => block.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? null;

function record(kind, id, data) {
  return { kind, id, version: 1, data };
}

// Parses the file with Python's XML parser when python3 is installed. Skipped otherwise.
function wellFormedCheck(xml) {
  const probe = spawnSync('python3', ['-I', '-c', 'import sys,xml.etree.ElementTree as E;E.fromstring(sys.stdin.buffer.read())'], { input: xml });
  if (probe.error) return 'skipped';
  assert.equal(probe.status, 0, probe.stderr.toString());
  return 'ok';
}

test('demo coursework becomes one summary per course with a child task each', () => {
  const xml = buildSchoolProjectXml({ records: scenarioRecords(), now: NOW, timeZone: 'America/Toronto' });
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'));
  assert.ok(xml.includes(`<Project xmlns="${NS}">`));
  const blocks = tasksOf(xml);
  assert.equal(blocks.length, 2 + 5, 'two course summaries and five coursework tasks in the demo fixture');
  const summaries = blocks.filter(block => field(block, 'Summary') === '1');
  assert.equal(summaries.length, 2);
  const uids = blocks.map(block => field(block, 'UID'));
  assert.equal(new Set(uids).size, uids.length, 'every UID is unique');
  assert.ok(summaries.some(block => field(block, 'Name') === 'DES 210 Systems design'));
});

test('each due date becomes a Finish No Later Than constraint in the local time zone', () => {
  const xml = buildSchoolProjectXml({ records: scenarioRecords(), now: NOW, timeZone: 'America/Toronto' });
  const dated = tasksOf(xml).filter(block => field(block, 'ConstraintType') === '7');
  assert.ok(dated.length >= 1);
  // 2026-10-08T20:00:00Z is 16:00 in Toronto (EDT, UTC-4).
  assert.ok(dated.some(block => field(block, 'ConstraintDate') === '2026-10-08T16:00:00'));
  for (const block of dated) assert.match(field(block, 'ConstraintDate'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

test('durations use remaining minutes first, then estimates, with a 30 minute floor and a 60 minute placeholder', () => {
  const records = {
    course: [record('course', 'c1', { code: 'ENV 120', title: 'Environmental systems' })],
    task: [
      record('task', 't1', { title: 'Reading', courseId: 'c1', status: 'todo', remainingMinutes: 90, estimatedMinutes: 240 }),
      record('task', 't2', { title: 'Quiz prep', courseId: 'c1', status: 'todo', estimatedMinutes: 10 }),
      record('task', 't3', { title: 'Essay outline', courseId: 'c1', status: 'todo' }),
    ],
  };
  const xml = buildSchoolProjectXml({ records, now: NOW });
  const durations = Object.fromEntries(tasksOf(xml).filter(block => field(block, 'Summary') === '0').map(block => [field(block, 'Name'), field(block, 'Duration')]));
  assert.equal(durations.Reading, 'PT1H30M0S');
  assert.equal(durations['Quiz prep'], 'PT0H30M0S');
  assert.equal(durations['Essay outline'], 'PT1H0M0S');
});

test('archived, cancelled and unknown-course tasks are handled as documented', () => {
  const records = {
    course: [record('course', 'c1', { code: 'DES 210', title: 'Systems design' })],
    task: [
      record('task', 'a', { title: 'Old draft', courseId: 'c1', status: 'archived' }),
      record('task', 'b', { title: 'Dropped idea', courseId: 'c1', status: 'cancelled' }),
      record('task', 'c', { title: 'Hidden', courseId: 'c1', status: 'todo', archived: true }),
      record('task', 'd', { title: 'Loose task', courseId: 'missing-course', status: 'todo' }),
    ],
  };
  const xml = buildSchoolProjectXml({ records, now: NOW });
  assert.ok(!xml.includes('Old draft') && !xml.includes('Dropped idea') && !xml.includes('Hidden'));
  assert.ok(xml.includes('<Name>Unassigned</Name>'));
  assert.ok(xml.includes('<Name>Loose task</Name>'));
});

test('notes, drafts and next steps are never written to the file', () => {
  const records = {
    course: [record('course', 'c1', { code: 'DES 210', title: 'Systems design' })],
    task: [record('task', 't1', { title: 'Map loop', courseId: 'c1', status: 'todo', notes: 'PRIVATE-NOTE-TEXT', nextStep: 'PRIVATE-NEXT-STEP', sourceUrl: 'https://example.invalid/PRIVATE-LINK' })],
  };
  const xml = buildSchoolProjectXml({ records, now: NOW });
  assert.ok(!xml.includes('PRIVATE-NOTE-TEXT'));
  assert.ok(!xml.includes('PRIVATE-NEXT-STEP'));
  assert.ok(!xml.includes('PRIVATE-LINK'));
});

test('completed coursework reports 100 percent complete', () => {
  const records = {
    task: [record('task', 't1', { title: 'Submitted lab', status: 'submitted', estimatedMinutes: 60 })],
  };
  const block = tasksOf(buildSchoolProjectXml({ records, now: NOW })).find(item => field(item, 'Name') === 'Submitted lab');
  assert.equal(field(block, 'PercentComplete'), '100');
});

test('special characters in titles are escaped and control characters are removed', () => {
  assert.equal(xmlText(`A & B <C> "D" 'E'`), 'A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;');
  assert.equal(xmlText('bad\u0001char'), 'badchar');
  const records = { task: [record('task', 't1', { title: 'Lab & <report>', status: 'todo', estimatedMinutes: 60 })] };
  const xml = buildSchoolProjectXml({ records, now: NOW });
  assert.ok(xml.includes('<Name>Lab &amp; &lt;report&gt;</Name>'));
});

test('an invalid start time is rejected', () => {
  assert.throws(() => buildSchoolProjectXml({ records: {}, now: 'not a date' }), RangeError);
});

test('the output is well-formed XML when python3 is available', () => {
  const xml = buildSchoolProjectXml({ records: { ...scenarioRecords(), task: [record('task', 't9', { title: 'R&D <draft>', status: 'todo', dueDate: '2026-10-09', estimatedMinutes: 45 })] }, now: NOW });
  const outcome = wellFormedCheck(xml);
  if (outcome === 'skipped') console.log('python3 not found; well-formedness check skipped');
});

test('the export command writes a file and refuses to overwrite it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lifeos-project-'));
  try {
    const out = join(dir, 'plan.xml');
    const first = spawnSync(process.execPath, ['tools/export-school-project.mjs', '--demo', '--out', out], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const xml = await readFile(out, 'utf8');
    assert.equal(tasksOf(xml).length, 7);
    const second = spawnSync(process.execPath, ['tools/export-school-project.mjs', '--demo', '--out', out], { encoding: 'utf8' });
    assert.notEqual(second.status, 0, 'an existing plan must not be overwritten');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
