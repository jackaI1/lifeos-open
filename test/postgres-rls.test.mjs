// Row-level security against a real PostgreSQL server (TEST_DATABASE_URL). The tests
// connect as an ordinary role, because superusers and BYPASSRLS roles skip the policies.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const admin = process.env.TEST_DATABASE_URL;
const enabled = !!admin && admin.startsWith('postgres');
const ROLE = 'lifeos_rls_test_app';
const PASSWORD = 'fictional-rls-test-password';
const options = {skip: !enabled, timeout: 60_000};

async function setUp() {
  const {PostgresDatabase} = await import('../src/storage/postgres.ts');
  const schema = `rls_${randomUUID().replaceAll('-', '')}`;
  const bootstrap = new PostgresDatabase({connectionString: admin, max: 1});
  await bootstrap.exec(`CREATE SCHEMA ${schema}`);
  const owner = new PostgresDatabase({connectionString: admin, options: `-c search_path=${schema}`, max: 2});
  await owner.migrate();
  // Checked in JavaScript: PostgresDatabase.exec rewrites placeholders, which would mangle a DO block.
  if (!await owner.prepare('SELECT 1 AS found FROM pg_roles WHERE rolname=?').bind(ROLE).first()) {
    await owner.exec(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
  }
  await owner.exec(`GRANT USAGE ON SCHEMA ${schema} TO ${ROLE}`);
  await owner.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${ROLE}`);
  const appUrl = new URL(admin);
  appUrl.username = ROLE;
  appUrl.password = PASSWORD;
  const connect = workspaceId => new PostgresDatabase({connectionString: appUrl.href, workspaceId, options: `-c search_path=${schema}`, max: 2});
  return {schema, owner, bootstrap, alpha: connect('alpha'), beta: connect('beta'), appUrl: appUrl.href, async done() {
    await owner.close(); await bootstrap.exec(`DROP SCHEMA ${schema} CASCADE`);
    await bootstrap.close();
  }};
}

const insertRecord = (db, id, kind = 'calendar-event') => db.prepare(
  'INSERT INTO records(kind,id,data,version,created_at,updated_at)VALUES(?,?,?,?,?,?)',
).bind(kind, id, JSON.stringify({title: `Row ${id}`}), 1, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z').run();
const visibleIds = async (db, kind = 'calendar-event') =>
  (await db.prepare('SELECT id FROM records WHERE kind=? ORDER BY id').bind(kind).all()).results.map(row => row.id);

test('a workspace reads and writes its own rows', options, async () => {
  const env = await setUp();
  try {
    await insertRecord(env.alpha, 'alpha-lab');
    assert.deepEqual(await visibleIds(env.alpha), ['alpha-lab']);
    assert.deepEqual(await visibleIds(env.beta), [], 'beta cannot see alpha rows');
  } finally { await env.alpha.close(); await env.beta.close(); await env.done(); }
});

test('a workspace cannot update or delete another workspace\'s row', options, async () => {
  const env = await setUp();
  try {
    await insertRecord(env.alpha, 'alpha-exam');
    const update = await env.beta.prepare("UPDATE records SET data='{\"title\":\"changed\"}' WHERE id='alpha-exam'").run();
    assert.equal(update.meta.changes, 0);
    const remove = await env.beta.prepare("DELETE FROM records WHERE id='alpha-exam'").run();
    assert.equal(remove.meta.changes, 0);
    const owner = await env.alpha.prepare("SELECT data FROM records WHERE id='alpha-exam'").first('data');
    assert.equal(JSON.parse(owner).title, 'Row alpha-exam', 'the owner row is unchanged');
  } finally { await env.alpha.close(); await env.beta.close(); await env.done(); }
});

test('a workspace cannot write a row that claims another workspace', options, async () => {
  const env = await setUp();
  try {
    await assert.rejects(
      env.beta.prepare("INSERT INTO records(kind,id,data,version,created_at,updated_at,workspace_id)VALUES('finance-transaction','forged','{}',1,'t','t','alpha')").run(),
      /row-level security/,
    );
    assert.deepEqual(await visibleIds(env.alpha, 'finance-transaction'), []);
  } finally { await env.alpha.close(); await env.beta.close(); await env.done(); }
});

test('rows written without naming a workspace are stamped with the writer\'s workspace', options, async () => {
  const env = await setUp();
  try {
    await insertRecord(env.beta, 'beta-assignment', 'school');
    assert.deepEqual(await visibleIds(env.alpha, 'school'), []);
    assert.deepEqual(await visibleIds(env.beta, 'school'), ['beta-assignment']);
    const stamp = await env.owner.prepare("SELECT workspace_id FROM records WHERE id='beta-assignment'").first('workspace_id');
    assert.equal(stamp, 'beta');
  } finally { await env.alpha.close(); await env.beta.close(); await env.done(); }
});

test('academic, calendar and finance rows are all isolated', options, async () => {
  const env = await setUp();
  try {
    for (const kind of ['school', 'calendar-event', 'finance-transaction']) await insertRecord(env.alpha, `alpha-${kind}`, kind);
    for (const kind of ['school', 'calendar-event', 'finance-transaction']) {
      assert.deepEqual(await visibleIds(env.beta, kind), [], `beta sees no ${kind}`);
      assert.deepEqual(await visibleIds(env.alpha, kind), [`alpha-${kind}`]);
    }
  } finally { await env.alpha.close(); await env.beta.close(); await env.done(); }
});

test('the audit log follows the same rule', options, async () => {
  const env = await setUp();
  try {
    await env.alpha.prepare('INSERT INTO audit(id,kind,record_id,before_json,after_json,created_at,actor,undo_of)VALUES(?,?,?,?,?,?,?,?)')
      .bind('audit-alpha-1', 'task', 'x', null, '{}', 't', 'owner', null).run();
    assert.equal(await env.beta.prepare('SELECT count(*) n FROM audit').first('n'), 0);
    await assert.rejects(
      env.beta.prepare("INSERT INTO audit(id,kind,record_id,before_json,after_json,created_at,actor,undo_of,workspace_id)VALUES('forged','task','x',NULL,'{}','t','owner',NULL,'alpha')").run(),
      /row-level security/,
    );
  } finally { await env.alpha.close(); await env.beta.close(); await env.done(); }
});

test('a session with no workspace sees nothing and cannot write', options, async () => {
  const env = await setUp();
  try {
    await insertRecord(env.alpha, 'alpha-only');
    const client = new pg.Client({connectionString: env.appUrl, options: `-c search_path=${env.schema}`});
    await client.connect();
    try {
      assert.equal((await client.query('SELECT count(*)::int n FROM records')).rows[0].n, 0);
      await assert.rejects(client.query("INSERT INTO records(kind,id,data,version,created_at,updated_at)VALUES('task','none','{}',1,'t','t')"), /null value|row-level security|workspace/i);
    } finally { await client.end(); }
  } finally { await env.alpha.close(); await env.beta.close(); await env.done(); }
});

test('row-level security is enabled and forced on records and audit', options, async () => {
  const env = await setUp();
  try {
    const rows = (await env.owner.prepare(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN ('records','audit') AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname=?) ORDER BY relname`).bind(env.schema).all()).results;
    assert.deepEqual(rows.map(row => [row.relname, row.relrowsecurity, row.relforcerowsecurity]), [['audit', true, true], ['records', true, true]]);
  } finally { await env.alpha.close(); await env.beta.close(); await env.done(); }
});

test('invalid workspace names are refused before any connection', async () => {
  const {PostgresDatabase} = await import('../src/storage/postgres.ts');
  assert.throws(() => new PostgresDatabase({connectionString: 'postgres://127.0.0.1:1/x', workspaceId: "bad'; drop"}), /Workspace id/);
});
