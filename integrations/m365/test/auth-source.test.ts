import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileCachePlugin, loginWithDeviceCode, silentTokenProvider, NotSignedInError, GRAPH_SCOPES, type MsalApp, type MsalAccount} from '../src/auth.ts';
import {loadConfig} from '../src/config.ts';
import {readLifeos} from '../src/lifeos-source.ts';

const account: MsalAccount = {homeAccountId: 'h', username: 'student@example.test'};

function fakeApp(accounts: MsalAccount[]) {
  const calls: {forceRefresh?: boolean; scopes: string[]}[] = [];
  const app: MsalApp = {
    getTokenCache: () => ({getAllAccounts: async () => accounts}),
    acquireTokenSilent: async (request) => {
      calls.push({forceRefresh: request.forceRefresh, scopes: request.scopes});
      return {accessToken: request.forceRefresh ? 'renewed' : 'cached', account};
    },
    acquireTokenByDeviceCode: async (request) => {
      request.deviceCodeCallback({userCode: 'ABCD1234', verificationUri: 'https://microsoft.com/devicelogin', message: 'To sign in, open the page and enter ABCD1234', expiresIn: 900});
      return {accessToken: 'tok', account};
    },
  };
  return {app, calls};
}

test('device-code login shows the code and returns the account', async () => {
  const shown: string[] = [];
  const result = await loginWithDeviceCode(fakeApp([]).app, GRAPH_SCOPES, (prompt) => shown.push(`${prompt.userCode} ${prompt.verificationUri} ${prompt.expiresInSeconds}`));
  assert.equal(result.username, 'student@example.test');
  assert.deepEqual(shown, ['ABCD1234 https://microsoft.com/devicelogin 900']);
});

test('device-code login fails clearly when MSAL returns no account', async () => {
  const app = fakeApp([]).app;
  app.acquireTokenByDeviceCode = async () => null;
  await assert.rejects(loginWithDeviceCode(app, GRAPH_SCOPES, () => {}), /without an account/);
});

test('silent provider uses the cached account, requests the Graph scopes and supports forced refresh', async () => {
  const {app, calls} = fakeApp([account]);
  const getToken = silentTokenProvider(app);
  assert.equal(await getToken(), 'cached');
  assert.equal(await getToken({forceRefresh: true}), 'renewed');
  assert.deepEqual(calls.map((c) => c.forceRefresh), [false, true]);
  assert.deepEqual(calls[0].scopes, ['Sites.ReadWrite.All', 'User.Read']);
});

test('silent provider asks the user to sign in when the cache is empty', async () => {
  await assert.rejects(silentTokenProvider(fakeApp([]).app)(), NotSignedInError);
});

test('token cache file is written atomically with owner-only permissions and read back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'm365-cache-'));
  try {
    const path = join(dir, 'nested', 'cache.json');
    const plugin = fileCachePlugin(path);
    let stored = '';
    await plugin.beforeCacheAccess({tokenCache: {deserialize: () => assert.fail('missing cache must be ignored')}});
    await plugin.afterCacheAccess({cacheHasChanged: false, tokenCache: {serialize: () => 'x'}});
    await assert.rejects(stat(path));
    await plugin.afterCacheAccess({cacheHasChanged: true, tokenCache: {serialize: () => '{"AccessToken":{}}'}});
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await plugin.beforeCacheAccess({tokenCache: {deserialize: (data) => void (stored = data)}});
    assert.equal(stored, await readFile(path, 'utf8'));
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('configuration has safe defaults and reports missing required values', () => {
  const config = loadConfig({M365_CLIENT_ID: ' abc ', M365_SITE_URL: 'https://contoso.sharepoint.com/sites/LifeOS'}, ['clientId', 'siteUrl']);
  assert.equal(config.clientId, 'abc');
  assert.equal(config.tenantId, 'organizations');
  assert.equal(config.listName, 'LifeOS Tasks');
  assert.match(config.cachePath, /\.local\/m365-token-cache\.json$/);
  assert.throws(() => loadConfig({}, ['clientId', 'siteUrl']), /M365_CLIENT_ID, M365_SITE_URL/);
});

test('readLifeos reads tasks read-only, joins courses and omits notes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'm365-db-'));
  try {
    const path = join(dir, 'workspace.sqlite');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,version INTEGER,created_at TEXT,updated_at TEXT,PRIMARY KEY(kind,id))');
    const put = db.prepare("INSERT INTO records VALUES(?,?,?,1,'t','t')");
    put.run('settings', 'preferences', JSON.stringify({timezone: 'America/Vancouver'}));
    put.run('course', 'c1', JSON.stringify({code: 'DES 210', title: 'Systems design'}));
    put.run('task', 'a', JSON.stringify({title: 'Essay', courseId: 'c1', status: 'in-progress', dueAt: '2026-10-30T20:00:00Z', estimatedMinutes: 90, notes: 'PRIVATE NOTE', nextStep: 'PRIVATE STEP'}));
    put.run('task', 'b', JSON.stringify({title: 'Old', status: 'todo', archived: true, dueDate: '2026-09-01'}));
    put.run('task', 'c', 'not json');
    db.close();
    const snapshot = readLifeos(path);
    assert.equal(snapshot.timeZone, 'America/Vancouver');
    assert.deepEqual(snapshot.tasks.map((t) => t.id), ['a', 'b', 'c']);
    assert.equal(snapshot.tasks[0].courseCode, 'DES 210');
    assert.equal(snapshot.tasks[1].status, 'archived');
    assert.equal(snapshot.tasks[2].title, '');
    assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('readLifeos works against the real LifeOS demo workspace', async () => {
  const {LocalDatabase} = await import('../../../src/local/database.ts');
  const {makeWorkspace} = await import('../../../src/local/workspace.ts');
  const dir = await mkdtemp(join(tmpdir(), 'm365-demo-'));
  try {
    const path = join(dir, 'workspace.sqlite');
    const db = new LocalDatabase(path);
    await makeWorkspace(db, {now: new Date('2026-10-28T12:00:00Z'), demo: true, owner: 'demo@example.test'});
    db.close();
    const snapshot = readLifeos(path);
    assert.equal(snapshot.timeZone, 'America/Toronto');
    assert.ok(snapshot.tasks.length >= 5);
    assert.ok(snapshot.tasks.every((t) => t.title && t.courseCode));
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
