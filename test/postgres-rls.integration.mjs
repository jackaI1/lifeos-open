// Row-level security against a real PostgreSQL server. Runs when TEST_DATABASE_URL is set (CI
// starts a PostgreSQL service). The application role is a plain login role without BYPASSRLS,
// because superusers and BYPASSRLS roles skip row-level security by design.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresDatabase} from '../src/storage/postgres.ts';

const url = process.env.TEST_DATABASE_URL;

test('row-level security keeps each workspace to its own records', {skip: !url && 'set TEST_DATABASE_URL', timeout: 120000}, async t => {
  const hex = randomUUID().replaceAll('-', '');
  const schema = 'rls_' + hex;
  const role = 'lifeos_app_' + hex.slice(0, 12);
  const password = randomBytes(18).toString('hex');
  const bootstrap = new pg.Pool({connectionString: url, max: 1});
  const options = '-c search_path=' + schema;
  const owner = new PostgresDatabase({connectionString: url, options, max: 2});
  const appUrl = new URL(url);
  appUrl.username = role;
  appUrl.password = password;
  let a, b, raw;
  t.after(async () => {
    await a?.close();
    await b?.close();
    await raw?.end().catch(() => {});
    await owner.close().catch(() => {});
    await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await bootstrap.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN DROP OWNED BY ${role}; DROP ROLE ${role}; END IF; END $$`).catch(() => {});
    await bootstrap.end();
  });

  await bootstrap.query(`CREATE SCHEMA ${schema}`);
  await owner.migrate();
  await bootstrap.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
  await bootstrap.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await bootstrap.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  await bootstrap.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} TO ${role}`);

  a = new PostgresDatabase({connectionString: appUrl.toString(), options, max: 2}, undefined, undefined, 'workspace-a');
  b = new PostgresDatabase({connectionString: appUrl.toString(), options, max: 2}, undefined, undefined, 'workspace-b');
  const insert = (db, kind, id, data) => db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind(kind, id, JSON.stringify(data), 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z').run();
  const ids = async (db, kind = 'calendar-event') => (await db.prepare('SELECT id FROM records WHERE kind=? ORDER BY id').bind(kind).all()).results.map(r => r.id);

  // Each workspace writes its own rows; the application never names the workspace in SQL.
  await insert(a, 'calendar-event', 'ev-a-lab', {title: 'Workspace A lab'});
  await insert(a, 'finance-transaction', 'fin-a-1', {amount: 1200, note: 'Workspace A rent'});
  await insert(b, 'calendar-event', 'ev-b-lab', {title: 'Workspace B lab'});

  // Reads only see the caller's rows.
  assert.deepEqual(await ids(a), ['ev-a-lab']);
  assert.deepEqual(await ids(b), ['ev-b-lab']);
  assert.deepEqual(await ids(b, 'finance-transaction'), []);
  assert.deepEqual(await b.prepare("SELECT id FROM records WHERE id='fin-a-1'").all().then(r => r.results), []);

  // The same record id can exist in each workspace without a collision that reveals the other.
  await insert(b, 'calendar-event', 'fin-a-1', {title: 'B reuses the id'});
  assert.deepEqual(await ids(b), ['ev-b-lab', 'fin-a-1']);
  assert.deepEqual(await ids(a), ['ev-a-lab']);

  // Updates and deletes against another workspace's row affect nothing.
  const update = await b.prepare("UPDATE records SET data=? WHERE kind='finance-transaction' AND id='fin-a-1'").bind('{"amount":0}').run();
  assert.equal(update.meta.changes, 0);
  const remove = await b.prepare("DELETE FROM records WHERE kind='finance-transaction' AND id='fin-a-1'").run();
  assert.equal(remove.meta.changes, 0);
  assert.match(String((await a.prepare("SELECT data FROM records WHERE id='fin-a-1'").first('data'))), /Workspace A rent/);

  // A forged workspace_id in an insert is rejected by the policy, not silently accepted.
  await assert.rejects(
    b.prepare("INSERT INTO records(workspace_id,kind,id,data,version,created_at,updated_at) VALUES('workspace-a','calendar-event','forged','{}',1,'x','x')").run(),
    /row-level security/,
  );
  assert.deepEqual(await ids(a), ['ev-a-lab']);

  // Transactions keep the same scope.
  await a.transaction(async tx => insert(tx, 'calendar-event', 'ev-a-tx', {title: 'A in a transaction'}));
  assert.deepEqual(await ids(a), ['ev-a-lab', 'ev-a-tx']);
  assert.deepEqual(await ids(b), ['ev-b-lab', 'fin-a-1']);

  // A connection with no workspace set reads only the default workspace, which holds none of these rows.
  raw = new pg.Client({connectionString: appUrl.toString(), options});
  await raw.connect();
  const unscoped = await raw.query('SELECT COUNT(*)::int AS n FROM records');
  assert.equal(unscoped.rows[0].n, 0);
});
