import test from 'node:test';
import assert from 'node:assert/strict';
import {syncTasks, resolveSite} from '../src/sync.ts';
import {toDesiredItem, mapStatus, COLUMN} from '../src/mapping.ts';
import type {LifeosTask} from '../src/lifeos-source.ts';
import {FakeGraph} from './fake-graph.ts';

const task = (over: Partial<LifeosTask> = {}): LifeosTask => ({
  id: 'task-1',
  title: 'Map the feedback loop',
  status: 'todo',
  courseCode: 'DES 210',
  courseTitle: 'Systems design',
  dueDate: null,
  dueAt: '2026-10-30T20:00:00.000Z',
  estimatedMinutes: 60,
  ...over,
});
const site = (fake: FakeGraph) => ({id: fake.siteId, webUrl: 'https://contoso.sharepoint.com/sites/LifeOS'});
const options = {listName: 'LifeOS Tasks', timeZone: 'America/Toronto'};

test('first sync creates the list with its columns and one item per task', async () => {
  const fake = new FakeGraph();
  const result = await syncTasks(fake.client(), site(fake), [task(), task({id: 'task-2', title: 'Read', dueAt: null, dueDate: '2026-10-31'})], options);
  assert.equal(result.listCreated, true);
  assert.equal(result.created, 2);
  const list = fake.list('LifeOS Tasks');
  assert.deepEqual(list.columns.map((c) => c.name), ['Title', 'LifeOSId', 'Course', 'DueDate', 'DueAt', 'Status', 'EstimatedMinutes', 'SyncHash']);
  const first = [...list.items.values()][0];
  assert.equal(first.Title, 'Map the feedback loop');
  assert.equal(first[COLUMN.course], 'DES 210 – Systems design');
  assert.equal(first[COLUMN.status], 'Not started');
  assert.equal(first[COLUMN.dueDate], '2026-10-30T00:00:00Z');
  assert.equal(first[COLUMN.minutes], 60);
});

test('second sync with no changes writes nothing', async () => {
  const fake = new FakeGraph();
  await syncTasks(fake.client(), site(fake), [task()], options);
  fake.requests.length = 0;
  const result = await syncTasks(fake.client(), site(fake), [task()], options);
  assert.deepEqual([result.created, result.updated, result.unchanged], [0, 0, 1]);
  assert.deepEqual(fake.writes, []);
});

test('a changed task patches only the columns that differ', async () => {
  const fake = new FakeGraph();
  await syncTasks(fake.client(), site(fake), [task()], options);
  fake.requests.length = 0;
  const result = await syncTasks(fake.client(), site(fake), [task({status: 'complete'})], options);
  assert.equal(result.updated, 1);
  assert.equal(fake.writes.length, 1);
  assert.match(fake.writes[0], /^PATCH .*\/items\/\d+\/fields$/);
  const stored = [...fake.list('LifeOS Tasks').items.values()][0];
  assert.equal(stored[COLUMN.status], 'Completed');
});

test('a clean sync leaves SharePoint edits to untouched columns alone', async () => {
  const fake = new FakeGraph();
  await syncTasks(fake.client(), site(fake), [task()], options);
  [...fake.list('LifeOS Tasks').items.values()][0].Title = 'Renamed in SharePoint';
  await syncTasks(fake.client(), site(fake), [task()], options);
  assert.equal([...fake.list('LifeOS Tasks').items.values()][0].Title, 'Renamed in SharePoint');
  await syncTasks(fake.client(), site(fake), [task()], {...options, force: true});
  assert.equal([...fake.list('LifeOS Tasks').items.values()][0].Title, 'Map the feedback loop');
});

test('removing a due date clears the SharePoint column', async () => {
  const fake = new FakeGraph();
  await syncTasks(fake.client(), site(fake), [task()], options);
  await syncTasks(fake.client(), site(fake), [task({dueAt: null, dueDate: null})], options);
  const stored = [...fake.list('LifeOS Tasks').items.values()][0];
  assert.equal(stored[COLUMN.dueDate], null);
  assert.equal(stored[COLUMN.dueAt], null);
});

test('items already in the list are adopted by LifeOSId instead of duplicated (lost state is harmless)', async () => {
  const fake = new FakeGraph();
  await syncTasks(fake.client(), site(fake), [task()], options);
  const items = fake.list('LifeOS Tasks').items;
  [...items.values()][0][COLUMN.hash] = 'stale';
  const result = await syncTasks(fake.client(), site(fake), [task()], options);
  assert.equal(items.size, 1);
  assert.equal(result.updated, 1);
});

test('orphans are kept by default and deleted only with prune; manual items are never touched', async () => {
  const fake = new FakeGraph();
  await syncTasks(fake.client(), site(fake), [task(), task({id: 'task-2', title: 'Old'})], options);
  const list = fake.list('LifeOS Tasks');
  list.items.set('manual', {Title: 'Added by hand'});
  const kept = await syncTasks(fake.client(), site(fake), [task()], options);
  assert.equal(kept.orphaned, 1);
  assert.equal(kept.pruned, 0);
  assert.equal(list.items.size, 3);
  const pruned = await syncTasks(fake.client(), site(fake), [task()], {...options, prune: true});
  assert.equal(pruned.pruned, 1);
  assert.deepEqual([...list.items.values()].map((i) => i.Title).sort(), ['Added by hand', 'Map the feedback loop']);
});

test('dry run reports the plan and makes no writes, including when the list does not exist', async () => {
  const fake = new FakeGraph();
  const first = await syncTasks(fake.client(), site(fake), [task()], {...options, dryRun: true});
  assert.equal(first.created, 1);
  assert.equal(first.listCreated, true);
  assert.deepEqual(fake.writes, []);
  await syncTasks(fake.client(), site(fake), [task()], options);
  fake.requests.length = 0;
  const second = await syncTasks(fake.client(), site(fake), [task({title: 'Changed'})], {...options, dryRun: true, prune: true});
  assert.equal(second.updated, 1);
  assert.deepEqual(fake.writes, []);
});

test('a column missing from an existing list is added', async () => {
  const fake = new FakeGraph();
  await syncTasks(fake.client(), site(fake), [task()], options);
  const list = fake.list('LifeOS Tasks');
  list.columns = list.columns.filter((c) => c.name !== 'EstimatedMinutes');
  const result = await syncTasks(fake.client(), site(fake), [task()], options);
  assert.deepEqual(result.columnsAdded, ['EstimatedMinutes']);
  assert.ok(list.columns.some((c) => c.name === 'EstimatedMinutes'));
});

test('throttling during a sync is retried transparently', async () => {
  const fake = new FakeGraph();
  const result = await syncTasks(fake.client({failFirst: 2}), site(fake), [task()], options);
  assert.equal(result.created, 1);
});

test('duplicate LifeOS ids in the input produce a single item', async () => {
  const fake = new FakeGraph();
  const result = await syncTasks(fake.client(), site(fake), [task(), task()], options);
  assert.equal(result.created, 1);
});

test('resolveSite maps a SharePoint URL to a Graph site and rejects other hosts', async () => {
  let requested = '';
  const client = new FakeGraph().client();
  client.getSiteByPath = async (host, path) => {
    requested = `${host}${path}`;
    return {id: 'id', webUrl: `https://${host}${path}`};
  };
  const resolved = await resolveSite(client, 'https://contoso.sharepoint.com/sites/LifeOS/');
  assert.equal(requested, 'contoso.sharepoint.com/sites/LifeOS');
  assert.equal(resolved.id, 'id');
  await assert.rejects(resolveSite(client, 'https://example.com/sites/LifeOS'), /SharePoint Online/);
  await assert.rejects(resolveSite(client, 'http://contoso.sharepoint.com/sites/LifeOS'), /SharePoint Online/);
});

test('status mapping covers every LifeOS status and falls back safely', () => {
  const expected: Record<string, string> = {
    todo: 'Not started', 'in-progress': 'In progress', blocked: 'Blocked', waiting: 'Waiting',
    complete: 'Completed', completed: 'Completed', submitted: 'Completed', cancelled: 'Archived', archived: 'Archived',
  };
  for (const [status, label] of Object.entries(expected)) assert.equal(mapStatus(status), label);
  assert.equal(mapStatus('something-new'), 'Not started');
});

test('due date derives from dueAt in the workspace time zone, and explicit dueDate wins', () => {
  // 02:00 UTC on 31 Oct is 22:00 on 30 Oct in Toronto (EDT).
  const late = toDesiredItem(task({dueAt: '2026-10-31T02:00:00Z', dueDate: null}), 'America/Toronto');
  assert.equal(late.fields[COLUMN.dueDate], '2026-10-30T00:00:00Z');
  assert.equal(toDesiredItem(task({dueAt: '2026-10-31T02:00:00Z', dueDate: null}), 'UTC').fields[COLUMN.dueDate], '2026-10-31T00:00:00Z');
  assert.equal(toDesiredItem(task({dueDate: '2026-11-05'}), 'America/Toronto').fields[COLUMN.dueDate], '2026-11-05T00:00:00Z');
  assert.equal(toDesiredItem(task({dueAt: 'garbage', dueDate: null}), 'UTC').fields[COLUMN.dueDate], null);
});

test('the hash is stable and sensitive to every synced field', () => {
  const base = toDesiredItem(task(), 'UTC');
  assert.equal(base.hash, toDesiredItem(task(), 'UTC').hash);
  assert.match(base.hash, /^[0-9a-f]{16}$/);
  for (const change of [{title: 'x'}, {status: 'blocked'}, {courseCode: 'X'}, {estimatedMinutes: 5}, {dueAt: '2026-11-01T00:00:00Z'}]) {
    assert.notEqual(toDesiredItem(task(change), 'UTC').hash, base.hash, JSON.stringify(change));
  }
});

test('long and empty titles are clamped to what SharePoint accepts', () => {
  assert.equal(toDesiredItem(task({title: 'x'.repeat(400)}), 'UTC').fields.Title?.toString().length, 255);
  assert.equal(toDesiredItem(task({title: ''}), 'UTC').fields.Title, '(untitled task)');
});
