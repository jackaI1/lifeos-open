// Starts one disposable LifeOS workspace for a test run. It uses a temporary
// SQLite file seeded with fictional records, records who owns the process, and
// proves that the process and its port are gone when the run ends.
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function startDisposableWorkspace({purpose}) {
  const directory = await mkdtemp(join(tmpdir(), 'lifeos-test-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let output = '';
  // Minimal environment: the test server must not inherit personal settings.
  const child = spawn(process.execPath, ['src/local/main.ts'], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      APP_ORIGIN: origin,
      LIFEOS_DATABASE: join(directory, 'workspace.sqlite'),
      DEMO_SEED: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const remember = chunk => { output = (output + chunk).slice(-4000); };
  child.stdout.on('data', remember);
  child.stderr.on('data', remember);
  // Synchronous last resort if the runner itself exits unexpectedly.
  const killOnExit = () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); };
  process.once('exit', killOnExit);

  const start = execFileSync('ps', ['-p', String(child.pid), '-o', 'lstart='], {encoding: 'utf8'}).trim();
  const ownership = {
    owner: `lifeos-open test runner: ${purpose}`,
    pid: child.pid,
    start,
    port,
    scope: 'disposable fictional SQLite workspace in a temporary directory',
    cleanup: `kill -TERM ${child.pid}`,
  };
  await writeFile(join(directory, 'ownership.json'), JSON.stringify(ownership, null, 2));

  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const exited = await Promise.race([once(child, 'exit').then(() => true), sleep(5000).then(() => false)]);
      if (!exited) {
        child.kill('SIGKILL');
        await once(child, 'exit');
      }
    }
    let processAlive = true;
    try { process.kill(child.pid, 0); } catch { processAlive = false; }
    let portOpen = true;
    try { await fetch(`${origin}/api/health`, {signal: AbortSignal.timeout(700)}); } catch { portOpen = false; }
    process.removeListener('exit', killOnExit);
    await rm(directory, {recursive: true, force: true});
    const verified = {pid: child.pid, port, processAlive, portOpen, temporaryDataRemoved: true};
    if (processAlive || portOpen) throw new Error(`Disposable workspace did not stop: ${JSON.stringify(verified)}`);
    return verified;
  };

  try {
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`Workspace exited before it was ready. Last output:\n${output.slice(-1500)}`);
      try {
        if ((await fetch(`${origin}/api/health`, {signal: AbortSignal.timeout(1000)})).ok) break;
      } catch { /* not listening yet */ }
      if (Date.now() > deadline) throw new Error(`Workspace was not ready on port ${port} after 30 seconds.`);
      await sleep(200);
    }
  } catch (error) {
    await stop();
    throw error;
  }
  console.log(`Disposable workspace ready: pid ${child.pid}, port ${port}, started ${start}. Cleanup: ${ownership.cleanup}`);
  return {origin, pid: child.pid, port, stop};
}
