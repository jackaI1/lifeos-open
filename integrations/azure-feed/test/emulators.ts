import {spawn, execFile as execFileCallback, type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, open, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import sql from 'mssql';
import {connect, migrate} from '../src/store.ts';

const execFile = promisify(execFileCallback);
const cwd = fileURLToPath(new URL('..', import.meta.url));
const run = (file: string, args: string[], env = process.env) => execFile(file, args, {cwd, env, maxBuffer: 1024 * 1024, timeout: 120000});
async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const address = server.address();
  const value = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return value;
}
export async function until(check: () => Promise<unknown>, description: string, children: ChildProcess[], timeout = 120000, signal?: AbortSignal) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Interrupted');
    if (children.some(child => child.exitCode !== null || child.signalCode !== null)) throw new Error(`Fixture exited while waiting for ${description}`);
    try {await check(); if (signal?.aborted) throw new Error('Interrupted'); return;}
    catch {
      if (signal?.aborted) throw new Error('Interrupted');
      await delay(500, undefined, {signal}).catch(() => {throw new Error('Interrupted');});
    }
  }
  throw new Error(`Timed out waiting for ${description}`);
}

/** Own only this invocation's container, process groups, ports and temporary data. */
export async function withEmulators<T>(use: (fixture: {url: string; storage: string}) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'lifeos-azure-'));
  const project = 'azure-feed-' + randomBytes(6).toString('hex');
  const children: ChildProcess[] = [];
  const files: Awaited<ReturnType<typeof open>>[] = [];
  const ownership: object[] = [];
  const ownedPorts: number[] = [];
  const oldEnv = {...process.env};
  const env = {...process.env, AZURE_FEED_TEST_SQL_PASSWORD: randomBytes(24).toString('base64') + 'aA1!'};
  const redact = [env.AZURE_FEED_TEST_SQL_PASSWORD];
  const compose = ['compose', '-p', project, '-f', 'compose.yaml'];
  const functionContainer = process.env.AZURE_FEED_CONTAINER_IMAGE ? project + '-function' : undefined;
  const signals = ['SIGINT', 'SIGTERM'] as const;
  const abort = new AbortController();
  const onSignal = () => abort.abort();
  const runStartup = (file: string, args: string[], runEnv = process.env) => execFile(file, args, {cwd, env: runEnv, signal: abort.signal, maxBuffer: 1024 * 1024, timeout: 120000});
  for (const signal of signals) process.once(signal, onSignal);
  async function start(file: string, args: string[], ports: number[], childEnv = process.env) {
    if (abort.signal.aborted) throw new Error('Interrupted');
    const log = await open(join(directory, children.length + '.log'), 'a');
    files.push(log);
    const child = spawn(file, args, {cwd, env: childEnv, detached: true, stdio: ['ignore', log.fd, log.fd]});
    children.push(child);
    await new Promise<void>((resolve, reject) => {child.once('spawn', resolve); child.once('error', reject);});
    const started = (await run('ps', ['-p', String(child.pid), '-o', 'lstart='])).stdout.trim();
    ownership.push({pid: child.pid, started, ports, cleanup: `kill -TERM -- -${child.pid}`});
    ownedPorts.push(...ports);
    await writeFile(join(directory, 'ownership.json'), JSON.stringify(ownership, null, 2));
  }
  try {
    ownership.push({project, cleanup: `docker compose -p ${project} -f compose.yaml down --volumes`});
    await writeFile(join(directory, 'ownership.json'), JSON.stringify(ownership, null, 2));
    console.log(`Starting owned fixture ${project}. Recovery metadata: ${directory}/ownership.json`);
    await runStartup('docker', [...compose, 'up', '-d', 'sql'], env);
    const id = (await run('docker', [...compose, 'ps', '-q', 'sql'], env)).stdout.trim();
    const [container] = JSON.parse((await run('docker', ['inspect', id])).stdout);
    const sqlPort = Number(container.NetworkSettings.Ports['1433/tcp'][0].HostPort);
    ownedPorts.push(sqlPort);
    ownership.push({container: id, pid: container.State.Pid, started: container.State.StartedAt, ports: [sqlPort], cleanup: `docker compose -p ${project} -f compose.yaml down --volumes`});
    await writeFile(join(directory, 'ownership.json'), JSON.stringify(ownership, null, 2));
    Object.assign(process.env, {SQL_SERVER: '127.0.0.1', SQL_PORT: String(sqlPort), SQL_DATABASE: 'lifeos_demo', SQL_USER: 'sa', SQL_PASSWORD: env.AZURE_FEED_TEST_SQL_PASSWORD, SQL_TRUST_SERVER_CERTIFICATE: 'true'});
    await until(async () => {
      const pool = new sql.ConnectionPool({server: '127.0.0.1', port: sqlPort, user: 'sa', password: env.AZURE_FEED_TEST_SQL_PASSWORD, database: 'master', options: {encrypt: true, trustServerCertificate: true}, connectionTimeout: 1500});
      try {await pool.connect(); await pool.request().query("IF DB_ID('lifeos_demo') IS NULL CREATE DATABASE lifeos_demo");}
      finally {await pool.close();}
    }, 'SQL Server', children, 120000, abort.signal);
    const readerPassword = randomBytes(24).toString('base64') + 'aA1!';
    redact.push(readerPassword);
    const owner = await connect();
    try {
      await migrate(owner);
      await owner.request().batch(`USE master; CREATE LOGIN demo_reader WITH PASSWORD = '${readerPassword}'; USE lifeos_demo; CREATE USER demo_reader FOR LOGIN demo_reader; GRANT SELECT ON dbo.PublicDemoFeed TO demo_reader;`);
    } finally {await owner.close();}
    const blobPort = await port(), queuePort = await port(), tablePort = await port(), httpPort = await port();
    const key = randomBytes(32).toString('base64');
    redact.push(key);
    const storage = `DefaultEndpointsProtocol=http;AccountName=lifeosdemo;AccountKey=${key};BlobEndpoint=http://127.0.0.1:${blobPort}/lifeosdemo;QueueEndpoint=http://127.0.0.1:${queuePort}/lifeosdemo;TableEndpoint=http://127.0.0.1:${tablePort}/lifeosdemo;`;
    Object.assign(process.env, {AZURITE_ACCOUNTS: `lifeosdemo:${key}`, AzureWebJobsStorage: storage, FUNCTIONS_WORKER_RUNTIME: 'node', FUNCTIONS_NODE_BLOCK_ON_ENTRY_POINT_ERROR: 'true'});
    await start(join(cwd, 'node_modules/.bin/azurite'), ['--silent', '--location', join(directory, 'storage'), '--blobPort', String(blobPort), '--queuePort', String(queuePort), '--tablePort', String(tablePort)], [blobPort, queuePort, tablePort]);
    await until(async () => {await fetch(`http://127.0.0.1:${blobPort}/`, {signal: AbortSignal.timeout(1000)});}, 'Azurite', children, 120000, abort.signal);
    const functionEnv = {...process.env, SQL_USER: 'demo_reader', SQL_PASSWORD: readerPassword};
    if (functionContainer) {
      await start('docker', ['run', '--rm', '--name', functionContainer, '--label', `lifeos.azure.fixture=${project}`, '--network', 'host',
        ...['SQL_SERVER', 'SQL_PORT', 'SQL_DATABASE', 'SQL_USER', 'SQL_PASSWORD', 'SQL_TRUST_SERVER_CERTIFICATE', 'AzureWebJobsStorage'].flatMap(name => ['--env', name]),
        '--env', `ASPNETCORE_URLS=http://0.0.0.0:${httpPort}`, process.env.AZURE_FEED_CONTAINER_IMAGE!], [httpPort], functionEnv);
    } else {
      await start(process.env.AZURE_FUNCTIONS_CORE_TOOLS || 'func', ['start', '--port', String(httpPort)], [httpPort], functionEnv);
    }
    const url = `http://127.0.0.1:${httpPort}`;
    await until(async () => {const response = await fetch(url + '/api/demo/today', {signal: AbortSignal.timeout(2000)}); if (response.status !== 503) throw new Error('Function not ready');}, 'Functions host', children, 120000, abort.signal);
    console.log(`Owned fixture ${project}: SQL ${sqlPort}, HTTP ${httpPort}; ${children.length} process groups. Cleanup metadata: ${directory}/ownership.json`);
    if (abort.signal.aborted) throw new Error('Interrupted');
    return await Promise.race([use({url, storage}), new Promise<never>((_, reject) => abort.signal.addEventListener('abort', () => reject(new Error('Interrupted')), {once: true}))]);
  } catch (error) {
    if (abort.signal.aborted) throw new Error('Interrupted');
    for (let index = 0; index < children.length; index++) {
      const log = await open(join(directory, index + '.log'), 'r');
      let tail: string;
      try {
        const {size} = await log.stat();
        const buffer = Buffer.alloc(Math.min(size, 3500));
        const {bytesRead} = await log.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
        tail = buffer.subarray(0, bytesRead).toString();
      } finally {await log.close();}
      for (const secret of redact) tail = tail.replaceAll(secret, '[redacted]');
      console.error(tail);
    }
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    const clean = async (action: () => Promise<void>) => {try {await action();} catch (error) {cleanupErrors.push(error);}};
    for (const signal of signals) process.removeListener(signal, onSignal);
    if (functionContainer) await clean(async () => {
      const exists = (await run('docker', ['ps', '-aq', '--filter', `name=^/${functionContainer}$`])).stdout.trim();
      if (exists) await run('docker', ['stop', '--time', '10', functionContainer]);
      const remains = (await run('docker', ['ps', '-aq', '--filter', `name=^/${functionContainer}$`])).stdout.trim();
      if (remains) await run('docker', ['rm', '-f', functionContainer]);
    });
    for (const child of children.reverse()) await clean(async () => {
      if (child.pid) {
        try {process.kill(-child.pid, 'SIGTERM');} catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;}
        const gone = async () => {try {process.kill(-child.pid!, 0);} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw error;} throw new Error('Process group remains');};
        await until(gone, 'process cleanup', [], 10000).catch(async () => {
          try {process.kill(-child.pid!, 'SIGKILL');} catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;}
          await until(gone, 'forced process cleanup', [], 5000);
        });
      }
    });
    await clean(async () => {
      await run('docker', [...compose, 'down', '--volumes', '--remove-orphans'], env);
      const remaining = (await run('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])).stdout.trim();
      if (remaining) throw new Error(`Owned container remains: ${remaining}`);
    });
    for (const value of ownedPorts) await clean(async () => {
      const probe = createServer();
      await new Promise<void>((resolve, reject) => {probe.once('error', reject); probe.listen(value, '127.0.0.1', resolve);});
      await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
    });
    for (const file of files) await clean(async () => {await file.close();});
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, `Cleanup incomplete. Ownership: ${directory}/ownership.json`);
    await rm(directory, {recursive: true});
    console.log(`Cleaned ${project}: 0 owned containers, 0 owned process groups and ${ownedPorts.length} released ports.`);
  }
}
