// Fast checks on the API and browser suite files. They do not start the app;
// tools/run-api-tests.mjs and tools/run-selenium-tests.mjs do that.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const csv = async name => {
  const [header, ...rows] = (await read(`test/api/data/${name}`)).trim().split('\n');
  const columns = header.split(',');
  return rows.map(line => Object.fromEntries(line.split(',').map((value, index) => [columns[index], value])));
};

const collection = JSON.parse(await read('test/api/lifeos-local.postman_collection.json'));
const folders = collection.item.map(item => item.name);

test('the Postman collection has one request per data-driven folder', () => {
  assert.deepEqual(folders, ['Read API', 'Save calendar event', 'Create task deadline', 'Change task deadline']);
  for (const item of collection.item) {
    assert.equal(typeof item.request.url, 'string', `${item.name} uses a URL string Newman resolves`);
    assert.ok(item.event.some(event => event.listen === 'test'), `${item.name} has assertions`);
  }
});

test('every case table has a case name and a legal expected status', async () => {
  for (const name of ['read-cases.csv', 'calendar-cases.csv', 'task-create-cases.csv', 'task-change-cases.csv']) {
    const rows = await csv(name);
    assert.ok(rows.length >= 7, `${name} covers more than one path`);
    const names = new Set();
    for (const row of rows) {
      assert.ok(row.case, `${name} has a case name`);
      assert.ok(!names.has(row.case), `${name} case names are unique: ${row.case}`);
      names.add(row.case);
      assert.ok(['200', '400', '403', '404', '409'].includes(row.expectedStatus), `${name}: ${row.case}`);
      if (row.expectedStatus !== '200') {
        assert.ok(row.expectedText || row.expectedCode, `${name}: ${row.case} says what the error should be`);
      }
    }
    assert.ok(rows.some(row => row.expectedStatus !== '200'), `${name} includes bad input`);
  }
});

test('the bad-input cases cover the validation rules the app enforces', async () => {
  const calendar = await csv('calendar-cases.csv');
  const tasks = await csv('task-create-cases.csv');
  const changes = await csv('task-change-cases.csv');
  assert.ok(calendar.some(row => row.expectedCode === 'csrf' && row.sendCsrf === 'no'));
  assert.ok(calendar.some(row => row.expectedStatus === '409'));
  assert.ok(calendar.some(row => row.rawBody));
  assert.ok(calendar.some(row => row.extraField));
  assert.ok(tasks.some(row => row.expectedStatus === '400' && row.minutes.startsWith('-')));
  assert.ok(changes.some(row => row.expectedStatus === '404'));
});

test('Python browser dependencies are pinned exactly', async () => {
  const pins = (await read('test/selenium-python/requirements.txt'))
    .split('\n').filter(line => line && !line.startsWith('#'));
  assert.ok(pins.length >= 2);
  for (const pin of pins) assert.match(pin, /^[a-z-]+==\d+\.\d+\.\d+$/, pin);
});

test('every browser check is a test function with an explicit page object', async () => {
  for (const file of ['test_add_event.py', 'test_edit_deadline.py', 'test_today_schedule.py']) {
    const source = await read(`test/selenium-python/${file}`);
    assert.match(source, /^def test_/m, `${file} defines a test`);
    assert.doesNotMatch(source, /time\.sleep|sleep\(/, `${file} uses explicit waits, not sleeps`);
  }
});

test('the Jenkinsfile runs the API and browser stages and publishes their reports', async () => {
  const jenkinsfile = await read('Jenkinsfile');
  assert.match(jenkinsfile, /stage\('API tests'\)/);
  assert.match(jenkinsfile, /stage\('Browser tests'\)/);
  assert.match(jenkinsfile, /npm run test:api/);
  assert.match(jenkinsfile, /npm run test:selenium/);
  assert.match(jenkinsfile, /junit testResults: 'test-results\/api\/\*\.xml'/);
  assert.match(jenkinsfile, /junit testResults: 'test-results\/selenium\/pytest\.xml'/);
});
