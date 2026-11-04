import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, access} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createService} from '../src/local/service.ts';
import {createWhisperWorker, pythonWhisper} from '../src/local/whisper.ts';
import {buildWhisperTranscript} from '../src/local/whisper-transcript.mjs';
import {nearestTranscriptNote, transcriptSeekSeconds} from '../public/lecture-transcript.js';

const lectureId = 'demo-lecture-feedback', origin = 'http://127.0.0.1:18745';
async function fixture(backend = 'sqlite') {
  const {openTestDatabase} = await import('./helpers/database.mjs');
  const app = await createService({storage: await openTestDatabase(backend), origin, env: {}});
  const session = await (await app.fetch(new Request(origin + '/api/session'))).json();
  const lectures = await (await app.fetch(new Request(origin + '/api/lectures?course=demo-course-design'))).json();
  const id = lectures.items[0].id;
  app.env.LOCAL_WHISPER = true;
  const request = (mid = crypto.randomUUID(), body = {}) => app.fetch(new Request(origin + '/api/lectures/' + id + '/transcribe', {method: 'POST', headers: {'content-type': 'application/json', origin, 'x-lifeos-csrf': session.csrf}, body: JSON.stringify({mutationId: mid, ...body})}));
  const state = async () => (await app.fetch(new Request(origin + '/api/lectures/' + id))).json();
  return {app, id, request, state};
}
const fakeOutput = [{duration: 6, segments: [{start: 1, end: 3, text: ' Recognized speech. '}]}];
const fakeInfer = async (manifest, output) => {assert.equal(JSON.parse(await readFile(manifest)).length, 1); await writeFile(output, JSON.stringify(fakeOutput));};

test('Whisper maps media seconds onto the shared ink clock across pauses and drift', () => {
  const clips = [{id: '0001', startMs: 10000, endMs: 30000, mediaDurationMs: 10000}, {id: '0002', startMs: 60000, endMs: 70000}];
  const transcript = buildWhisperTranscript(lectureId, clips, [{duration: 10, segments: [{start: 2, end: 5, text: 'one'}]}, {duration: 10, segments: [{start: 1, end: 11, text: 'two'}]}], 'tiny.en');
  assert.deepEqual(transcript.segments, [{clipId: '0001', startMs: 14000, endMs: 20000, text: 'one'}, {clipId: '0002', startMs: 61000, endMs: 70000, text: 'two'}]);
  assert.equal(transcript.mock, false);
  assert.equal(transcriptSeekSeconds(transcript.segments[0], clips[0]), 2);
  assert.equal(transcriptSeekSeconds(transcript.segments[1], clips[1]), 1);
});

test('transcript links the nearest visible handwritten stroke on another page', () => {
  const segment = {clipId: '0002', startMs: 61000};
  const note = (id, at, clipId = '0002', hidden = false) => ({id, startedAtOffsetMs: at, audioSegmentId: clipId, hidden});
  const pages = [['0001', {strokes: [note('wrong-clip', 61000, '0001'), note('hidden', 61000, '0002', true)]}], ['0002', {strokes: [note('match', 61500)]}]];
  assert.deepEqual(nearestTranscriptNote(segment, pages), {pageId: '0002', strokeId: 'match'});
  assert.equal(nearestTranscriptNote({...segment, startMs: 200000}, pages), null);
});

test('invalid or incomplete recognition cannot become a transcript; silence stays empty', () => {
  const clips = [{id: '0001', startMs: 0, endMs: 6000}];
  for (const output of [[], [{duration: 0, segments: []}], [{duration: 6, segments: [{start: NaN, end: 2, text: 'bad'}]}], [{duration: 6, segments: [{start: 1, end: 0, text: 'bad'}]}]]) assert.throws(() => buildWhisperTranscript(lectureId, clips, output, 'tiny.en'));
  assert.deepEqual(buildWhisperTranscript(lectureId, clips, [{duration: 6, segments: []}], 'tiny.en').segments, []);
});

test('transcription API rejects unconfigured services and unsaved audio; keeps the demo transcript', async () => {
  const f = await fixture();
  try {
    f.app.env.LOCAL_WHISPER = false;
    assert.equal((await f.request()).status, 503);
    assert.equal((await f.state()).transcript.mock, true);
    f.app.env.LOCAL_WHISPER = true;
    await f.app.db.prepare("UPDATE records SET data=json_set(data,'$.status','uploading') WHERE kind='lecture-clip'").run();
    assert.equal((await f.request()).status, 409);
  } finally {await f.app.close();}
});

test('transcription requests require CSRF, deduplicate active work and survive the generic job drainer', async () => {
  const f = await fixture();
  try {
    const denied = await f.app.fetch(new Request(origin + '/api/lectures/' + f.id + '/transcribe', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'}));
    assert.equal(denied.status, 403);
    const mid = crypto.randomUUID(), first = await (await f.request(mid)).json();
    assert.equal(first.job.status, 'queued');
    assert.deepEqual(await (await f.request(mid)).json(), first);
    assert.deepEqual(await (await f.request()).json(), first);
    assert.equal((await f.state()).transcription.job.status, 'queued');
    assert.equal((await f.app.db.prepare("SELECT count(*) n FROM jobs WHERE type='lecture-transcription'").first()).n, 1);
    assert.equal((await f.request(crypto.randomUUID(), {prompt: 'not accepted'})).status, 400);
    const duplicateId = crypto.randomUUID(), duplicate = await (await f.request(duplicateId)).json();
    await f.app.db.prepare("UPDATE jobs SET status='completed' WHERE id=?").bind(first.job.id).run();
    assert.deepEqual(await (await f.request(duplicateId)).json(), duplicate, 'active-work deduplication has a durable idempotency receipt');
    assert.equal((await f.app.db.prepare("SELECT count(*) n FROM jobs WHERE type='lecture-transcription'").first()).n, 1);
  } finally {await f.app.close();}
});

test('worker verifies saved chunks, stores an audited real transcript and removes temporary audio', async () => {
  const f = await fixture();let scratch;
  const worker = createWhisperWorker(f.app.db, {python: 'unused', model: 'tiny.en', infer: async (...args) => {scratch = dirname(args[0]); await fakeInfer(...args);}});
  try {
    await f.request();
    const one = worker.kick();assert.equal(worker.kick(), one);await one;
    const state = await f.state();
    assert.equal(state.transcription.job.status, 'completed');
    assert.equal(state.transcript.mock, false);
    assert.equal(state.transcript.engine, 'faster-whisper');
    assert.deepEqual(state.transcript.segments, [{clipId: '0000', startMs: 1000, endMs: 3000, text: 'Recognized speech.'}]);
    assert.ok(await f.app.db.prepare("SELECT 1 FROM audit WHERE kind='lecture-transcript' AND actor='local-whisper'").first());
    await assert.rejects(access(scratch));
  } finally {await worker.close();await f.app.close();}
});

for (const failure of ['corrupt-chunk', 'missing-chunk', 'inference-error', 'changed-clip', 'new-clip', 'cancelled']) test('worker preserves the previous transcript on ' + failure, async () => {
  const f = await fixture();let called = false, scratch;
  const worker = createWhisperWorker(f.app.db, {python: 'unused', infer: async (...args) => {
    called = true;scratch = dirname(args[0]);
    if (failure === 'inference-error') throw Error('Inference failed.');
    if (failure === 'changed-clip') await f.app.db.prepare("UPDATE records SET version=version+1 WHERE kind='lecture-clip'").run();
    if (failure === 'new-clip') await f.app.db.prepare("INSERT INTO records SELECT kind,id||'new',data,version,created_at,updated_at FROM records WHERE kind='lecture-clip' LIMIT 1").run();
    if (failure === 'cancelled') await f.app.db.prepare("UPDATE jobs SET cancel_requested=1 WHERE type='lecture-transcription'").run();
    await fakeInfer(...args);
  }});
  try {
    await f.request();
    if (failure === 'corrupt-chunk') await f.app.db.prepare("UPDATE local_objects SET content=x'0000' WHERE id='demo-audio-file'").run();
    if (failure === 'missing-chunk') await f.app.db.prepare("DELETE FROM local_objects WHERE id='demo-audio-file'").run();
    await worker.kick();
    const state = await f.state();assert.equal(state.transcription.job.status, 'failed');assert.equal(state.transcript.mock, true);
    if (failure.endsWith('chunk')) assert.equal(called, false);
    if (scratch) await assert.rejects(access(scratch));
    assert.equal((await f.request()).status, 200, 'failed jobs can be retried');
  } finally {await worker.close();await f.app.close();}
});

test('shutdown aborts inference, cleans audio and requeues the job; another worker resumes it', async () => {
  const f = await fixture();let started, scratch;
  const ready = new Promise(r => {started = r;});
  const worker = createWhisperWorker(f.app.db, {python: 'unused', infer: async (manifest, output, signal) => {scratch = dirname(manifest);started();await new Promise((done, reject) => signal.addEventListener('abort', () => reject(Error('stopped')), {once: true}));}});
  const next = createWhisperWorker(f.app.db, {python: 'unused', infer: fakeInfer});
  try {
    await f.request();const pending = worker.kick();await ready;await worker.close();await pending;
    assert.equal((await f.state()).transcription.job.status, 'queued');await assert.rejects(access(scratch));
    await next.kick();assert.equal((await f.state()).transcription.job.status, 'completed');
  } finally {await worker.close();await next.close();await f.app.close();}
});

test('expired inference leases are recovered without touching other job types', async () => {
  const f = await fixture(), worker = createWhisperWorker(f.app.db, {python: 'unused', infer: fakeInfer});
  try {
    await f.request();await f.app.db.prepare("UPDATE jobs SET status='running',lease_owner='old-worker',lease_until=0 WHERE type='lecture-transcription'").run();
    await worker.kick();assert.equal((await f.state()).transcription.job.status, 'completed');
  } finally {await worker.close();await f.app.close();}
});

test('missing Python reports a setup error and releases the subprocess handle', async () => {
  await assert.rejects(pythonWhisper('/does-not-exist/lifeos-python', 'tiny.en')('/does-not-exist/input.json', '/does-not-exist/output.json', new AbortController().signal));
});

for (const backend of ['sqlite', ...(process.env.TEST_DATABASE_URL ? ['postgres'] : [])]) test('transcription request/worker contract on ' + backend, async () => {
  const f = await fixture(backend), worker = createWhisperWorker(f.app.db, {python: 'unused', infer: fakeInfer});
  try {
    assert.equal((await f.request()).status, 200);await worker.kick();
    const state = await f.state();assert.equal(state.transcription.job.status, 'completed', state.transcription.job.error);
    assert.equal(state.transcript.mock, false);assert.equal(state.transcript.segments.length, 1);
  } finally {await worker.close();await f.app.close();}
});
