// Runs the Python Selenium checks against a disposable fictional workspace.
// LIFEOS_PYTHON picks the interpreter (the Jenkins image sets it to a venv).
// CHROME_BIN and CHROMEDRIVER are optional; Selenium Manager finds them otherwise.
import {mkdir, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startDisposableWorkspace} from './lib/disposable-workspace.mjs';

const reportDir = 'test-results/selenium';
const python = process.env.LIFEOS_PYTHON || 'python3';

function runPytest(origin) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [
      '-m', 'pytest', 'test/selenium-python',
      '-p', 'no:cacheprovider',
      '--junitxml', join(reportDir, 'pytest.xml'),
      '--tb=short',
    ], {
      env: {
        ...process.env,
        LIFEOS_TEST_URL: origin,
        LIFEOS_TEST_RESULTS: reportDir,
        PYTHONDONTWRITEBYTECODE: '1',
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
}

async function main() {
  await mkdir(reportDir, {recursive: true});
  const workspace = await startDisposableWorkspace({purpose: 'Selenium browser checks'});
  let code = 1;
  let cleanup;
  try {
    code = await runPytest(workspace.origin);
  } finally {
    cleanup = await workspace.stop();
    await writeFile(join(reportDir, 'workspace.json'), JSON.stringify({pid: workspace.pid, port: workspace.port, cleanup}, null, 2));
    console.log(`Workspace stopped: ${JSON.stringify(cleanup)}`);
  }
  process.exitCode = code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
