import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from './helpers/service.mjs';
import {cleanLearningNote} from '../src/cloud/learning-notes.mjs';
import {safeSharedUrl, sharedText, sharedTitle, studyNoteData} from '../public/share-target.js';

test('only web links from a share are kept', () => {
  assert.equal(safeSharedUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeSharedUrl(' http://example.org/page '), 'http://example.org/page');
  assert.equal(safeSharedUrl('javascript:alert(1)'), '');
  assert.equal(safeSharedUrl('file:///etc/passwd'), '');
  assert.equal(safeSharedUrl('not a link'), '');
  assert.equal(safeSharedUrl(undefined), '');
});

test('shared text keeps the link on its own line and respects the note limit', () => {
  assert.equal(sharedText({text: '  Synthetic lecture summary\r\n', url: 'https://example.com/slides'}),
    'Synthetic lecture summary\n\nhttps://example.com/slides');
  assert.equal(sharedText({text: '', url: 'javascript:void(0)'}), '');
  const long = sharedText({text: 'x'.repeat(9000), url: 'https://example.com/long'});
  assert.ok(long.length <= 6000);
  assert.ok(long.endsWith('https://example.com/long'), 'the link must survive truncation');
});

test('title falls back to the shared title, then the first line of text', () => {
  assert.equal(sharedTitle({title: 'Synthetic article', text: 'ignored'}), 'Synthetic article');
  assert.equal(sharedTitle({title: '', text: 'First line here\nSecond line'}), 'First line here');
  assert.equal(sharedTitle({title: '', text: '', url: ''}), 'Shared from my phone');
});

test('a shared item becomes a note the learning-notes API accepts', () => {
  const data = studyNoteData({courseId: 'demo-course-design', title: 'Synthetic article', text: 'Body'});
  assert.deepEqual(data, {type: 'concept', courseId: 'demo-course-design', title: 'Synthetic article', text: 'Body',
    misunderstanding: '', reasoning: '', status: 'unreviewed', linkedIds: []});
  assert.doesNotThrow(() => cleanLearningNote(data));
  assert.throws(() => studyNoteData({courseId: '', title: 'x', text: ''}), /Choose a course/);
  assert.throws(() => studyNoteData({courseId: 'demo-course-design', title: '   ', text: ''}), /Give the note a title/);
});

test('a shared item saved through the API appears in the study notes', async () => {
  const app = await createService({database: ':memory:', origin: 'http://127.0.0.1:18746'});
  try {
    const session = await (await app.fetch(new Request(app.origin + '/api/session'))).json();
    const post = body => app.fetch(new Request(app.origin + '/api/learning-notes', {
      method: 'POST',
      headers: {'content-type': 'application/json', origin: app.origin, 'x-lifeos-csrf': session.csrf},
      body: JSON.stringify(body),
    }));
    const id = 'shared-' + crypto.randomUUID();
    const data = studyNoteData({courseId: 'demo-course-design', title: 'Synthetic shared link', text: 'Synthetic body\n\nhttps://example.com/x'});
    const response = await post({mutationId: crypto.randomUUID(), id, version: 0, data});
    assert.equal(response.status, 200, await response.clone().text());
    const list = await (await app.fetch(new Request(app.origin + '/api/learning-notes'))).json();
    const saved = list.items.find(item => item.id === id);
    assert.ok(saved, 'the saved note must be listed');
    assert.equal(saved.data.title, 'Synthetic shared link');
    assert.equal(saved.data.status, 'unreviewed');
  } finally {
    await app.close();
  }
});
