import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import sql from 'mssql';
import {BlobServiceClient} from '@azure/storage-blob';
import {connect, migrate, publishFeed, readFeed} from '../src/store.ts';
import {withEmulators} from './emulators.ts';

await test('real SQL Server, Core Tools and Azurite', {timeout: 300000}, async t => {
  await withEmulators(async ({url, storage}) => {
    const pool = await connect();
    try {
      const fixture = JSON.parse(await readFile(new URL('../../../public/demo/today.json', import.meta.url), 'utf8'));
      await t.test('schema and publication are repeatable and preserve one snapshot', async () => {
        await migrate(pool); await migrate(pool);
        await publishFeed(pool, fixture); await publishFeed(pool, fixture);
        const rows = await pool.request().query('SELECT COUNT(*) AS total FROM dbo.PublicDemoFeed');
        assert.equal(rows.recordset[0].total, 1);
        assert.deepEqual(await readFeed(pool), fixture);
      });
      await t.test('SQL constraints reject private, invalid and unsupported documents', async () => {
        for (const document of ['not-json', JSON.stringify({...fixture, fictional: false}), JSON.stringify({...fixture, schemaVersion: 2}), '{}']) {
          await assert.rejects(pool.request().input('document', sql.NVarChar(sql.MAX), document).query("UPDATE dbo.PublicDemoFeed SET document = @document WHERE id = 'today'"));
        }
      });
      await t.test('the runtime SQL identity can read but cannot change the snapshot', async () => {
        // EXECUTE AS exercises the same restricted database user as the HTTP host.
        await pool.request().batch("EXECUTE AS USER = 'demo_reader'; SELECT document FROM dbo.PublicDemoFeed; REVERT;");
        await assert.rejects(pool.request().batch("EXECUTE AS USER = 'demo_reader'; BEGIN TRY DELETE FROM dbo.PublicDemoFeed; REVERT; END TRY BEGIN CATCH REVERT; THROW; END CATCH;"));
        assert.deepEqual(await readFeed(pool), fixture);
      });
      await t.test('the actual HTTP function serves the phone contract and conditional GET', async () => {
        const response = await fetch(url + '/api/demo/today');
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), fixture);
        const cached = await fetch(url + '/api/demo/today', {headers: {'if-none-match': response.headers.get('etag')!}});
        assert.equal(cached.status, 304);
        assert.equal(await cached.text(), '');
        assert.equal((await fetch(url + '/api/demo/today', {method: 'POST', body: '{}'})).status, 404);
      });
      await t.test('readiness writes its heartbeat through the real Azurite blob binding', async () => {
        const response = await fetch(url + '/api/health');
        assert.equal(response.status, 200);
        // SDK 12.33 uses the 2026-06-06 API implemented by pinned Azurite 3.37.
        const blob = BlobServiceClient.fromConnectionString(storage).getContainerClient('demo-health').getBlockBlobClient('latest.json');
        const heartbeat = JSON.parse((await blob.downloadToBuffer()).toString());
        assert.equal(heartbeat.status, 'ok');
        assert.equal(heartbeat.fictional, true);
      });
      await t.test('a missing feed fails closed and recovers after publication', async () => {
        await pool.request().query('DELETE FROM dbo.PublicDemoFeed');
        const response = await fetch(url + '/api/demo/today', {headers: {'if-none-match': '*'}});
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal((await fetch(url + '/api/health')).status, 503);
        await publishFeed(pool, fixture);
        assert.equal((await fetch(url + '/api/demo/today')).status, 200);
      });
      await t.test('a new snapshot changes the ETag and is immediately readable', async () => {
        const before = await fetch(url + '/api/demo/today');
        const updated = {...fixture, tasks: [...fixture.tasks, {id: 'demo-azure-test', title: 'Fictional lab preparation', status: 'todo'}]};
        await publishFeed(pool, updated);
        const after = await fetch(url + '/api/demo/today', {headers: {'if-none-match': before.headers.get('etag')!}});
        assert.equal(after.status, 200);
        assert.notEqual(after.headers.get('etag'), before.headers.get('etag'));
        assert.deepEqual(await after.json(), updated);
      });
    } finally {await pool.close();}
  });
});

await test('fixture cleanup also runs when its caller fails', {timeout: 300000}, async () => {
  await assert.rejects(withEmulators(async () => {throw new Error('Deliberate fixture cleanup check');}), /Deliberate fixture cleanup check/);
});
