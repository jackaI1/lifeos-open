// Runs the Postman collection with Newman against a disposable fictional
// workspace. Each folder has its own CSV table, so every row is one request.
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import newman from 'newman';
import {startDisposableWorkspace} from './lib/disposable-workspace.mjs';

const reportDir = 'test-results/api';
const collection = fileURLToPath(new URL('../test/api/lifeos-local.postman_collection.json', import.meta.url));
const dataFile = name => fileURLToPath(new URL(`../test/api/data/${name}`, import.meta.url));

const runs = [
  {name: 'read', folder: 'Read API', data: 'read-cases.csv'},
  {name: 'calendar', folder: 'Save calendar event', data: 'calendar-cases.csv'},
  {name: 'task-create', folder: 'Create task deadline', data: 'task-create-cases.csv'},
  {name: 'task-change', folder: 'Change task deadline', data: 'task-change-cases.csv'},
];

function runCollection({name, folder, data, origin}) {
  return new Promise((resolve, reject) => {
    newman.run({
      collection,
      folder,
      iterationData: dataFile(data),
      envVar: [{key: 'baseUrl', value: origin}],
      timeoutRequest: 10_000,
      color: 'off',
      reporters: ['cli', 'junit'],
      reporter: {junit: {export: join(reportDir, `${name}.xml`)}},
    }, (error, summary) => (error ? reject(error) : resolve(summary)));
  });
}

async function main() {
  await mkdir(reportDir, {recursive: true});
  const workspace = await startDisposableWorkspace({purpose: 'Postman and Newman API checks'});
  const report = {pid: workspace.pid, port: workspace.port, runs: []};
  let problems = 0;
  try {
    for (const run of runs) {
      const summary = await runCollection({...run, origin: workspace.origin});
      const stats = summary.run.stats;
      const failures = summary.run.failures.length;
      problems += failures;
      report.runs.push({
        name: run.name,
        iterations: stats.iterations.total,
        requests: stats.requests.total,
        assertions: stats.assertions.total,
        failedAssertions: stats.assertions.failed,
        failures,
      });
      console.log(`${run.name}: ${stats.iterations.total} rows, ${stats.assertions.total} assertions, ${failures} failures`);
    }
  } finally {
    report.cleanup = await workspace.stop();
    await writeFile(join(reportDir, 'summary.json'), JSON.stringify(report, null, 2));
    console.log(`Workspace stopped: ${JSON.stringify(report.cleanup)}`);
  }
  if (problems > 0) {
    process.exitCode = 1;
    console.error(`${problems} API checks failed.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
