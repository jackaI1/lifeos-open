// Writes a Microsoft Project (MSPDI XML) file from LifeOS school records.
// Usage:
//   npm run export:project -- --input lifeos-export.json --out school-plan.xml
//   npm run export:project -- --demo --out demo-plan.xml
// --input takes the JSON from Settings > Backups & export (or /api/export). Notes and attachments are never written.
import {readFile, writeFile} from 'node:fs/promises';
import {buildSchoolProjectXml} from '../src/domain/school-project.mjs';
import {scenarioRecords} from '../demo/scenarios.mjs';

const args = process.argv.slice(2);
const valueOf = flag => {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] ?? null;
};
const input = valueOf('--input');
const out = valueOf('--out');
const demo = args.includes('--demo');

if ((!input && !demo) || !out) {
  console.error('Usage: npm run export:project -- (--input lifeos-export.json | --demo) --out school-plan.xml');
  process.exitCode = 1;
} else {
  const parsed = demo ? null : JSON.parse(await readFile(input, 'utf8'));
  const records = demo ? scenarioRecords() : parsed.records ?? parsed;
  const xml = buildSchoolProjectXml({ records, now: new Date(), title: demo ? 'LifeOS demo school plan' : 'LifeOS school plan' });
  // 'wx' refuses to overwrite an existing file, so an older plan is never lost.
  await writeFile(out, xml, { flag: 'wx' });
  const tasks = (records.task ?? []).length;
  console.log(`Wrote ${out} with ${tasks} coursework records. Open it in Microsoft Project with File > Open.`);
}
