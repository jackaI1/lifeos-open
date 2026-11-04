// Explicit real-model test: npm run test:whisper (model must be downloaded first).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {createService} from '../src/local/service.ts';
import {transcriptSeekSeconds, nearestTranscriptNote} from '../public/lecture-transcript.js';

function words(text) {return text.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/);}
function wordErrorRate(reference, actual) {
  const a = words(reference), b = words(actual);let row = b.map((_, i) => i + 1);row.unshift(0);
  for (let i = 1; i <= a.length; i++) {const next = [i];for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j-1]+1, row[j]+1, row[j-1]+Number(a[i-1]!==b[j-1]));row = next;}
  return row[b.length] / a.length;
}

test('real offline Whisper recognizes the public-domain clip through the API worker and links ink timestamps', {timeout: 120000}, async () => {
  const origin = 'http://127.0.0.1:18746', model = 'tiny.en';
  const app = await createService({database: ':memory:', origin, env: {WHISPER_PYTHON: process.env.WHISPER_PYTHON ?? 'python3', WHISPER_MODEL: model}});
  const started = performance.now();
  try {
    const audio = await readFile('test/fixtures/whisper/jfk.wav'), sha = createHash('sha256').update(audio).digest('hex');
    assert.equal(sha, '59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e');
    const lectures = await (await app.fetch(new Request(origin + '/api/lectures?course=demo-course-design'))).json(), id = lectures.items[0].id;
    await app.db.prepare("UPDATE local_objects SET content=? WHERE id='demo-audio-file'").bind(audio).run();
    await app.db.prepare("UPDATE chunks SET sha256=?,size=? WHERE drive_id='demo-audio-file'").bind(sha, audio.length).run();
    // Deliberate 2:1 clock/media drift and a pause before the clip.
    await app.db.prepare("UPDATE records SET data=json_set(data,'$.startMs',10000,'$.endMs',32000,'$.mediaDurationMs',11000),version=version+1 WHERE kind='lecture-clip'").run();
    const session = await (await app.fetch(new Request(origin + '/api/session'))).json();
    const response = await app.fetch(new Request(origin + '/api/lectures/' + id + '/transcribe', {method: 'POST', headers: {'content-type': 'application/json', origin, 'x-lifeos-csrf': session.csrf}, body: JSON.stringify({mutationId: crypto.randomUUID()})}));
    assert.equal(response.status, 200, await response.clone().text());
    const queued = await response.json();assert.equal(queued.job.status, 'queued');
    assert.equal((await app.fetch(new Request(origin + '/api/health'))).status, 200, 'workspace remains responsive during inference');
    let state;
    const deadline = Date.now() + 100000;
    do {
      state = await (await app.fetch(new Request(origin + '/api/lectures/' + id))).json();
      if (['completed','failed'].includes(state.transcription.job.status)) break;
      await new Promise(r => setTimeout(r, 100));
    } while (Date.now() < deadline);
    assert.equal(state.transcription.job.status, 'completed', state.transcription.job.error);
    const transcript = state.transcript, reference = await readFile('test/fixtures/whisper/reference.txt', 'utf8');
    const wer = wordErrorRate(reference, transcript.text);
    assert.equal(transcript.mock, false);assert.equal(transcript.engine, 'faster-whisper');
    assert.ok(wer <= 0.20, `Word error rate ${(wer*100).toFixed(1)}% exceeds 20%`);
    assert.ok(transcript.segments.length >= 2);
    for (const segment of transcript.segments) {
      assert.equal(segment.clipId, '0000');assert.ok(segment.startMs >= 10000 && segment.endMs <= 32000 && segment.endMs > segment.startMs);
      const seconds = transcriptSeekSeconds(segment, state.clips[0].data);
      assert.ok(seconds >= 0 && seconds < 11);
    }
    const target = transcript.segments[1], ink = {id: 'public-fixture-note', audioSegmentId: target.clipId, startedAtOffsetMs: target.startMs + 100};
    assert.deepEqual(nearestTranscriptNote(target, [['0002', {strokes: [ink]}]]), {pageId: '0002', strokeId: ink.id});
    const evaluation = {fixture: 'jfk.wav', sha256: sha, model, engine: transcript.engine, audioSeconds: 11, wordErrorRate: wer, segments: transcript.segments, elapsedSeconds: Number(((performance.now()-started)/1000).toFixed(2))};
    await mkdir('.runtime/whisper', {recursive: true});await writeFile(resolve('.runtime/whisper/evaluation.json'), JSON.stringify(evaluation, null, 2));
    console.log(`REAL WHISPER: 11-second public-domain clip, ${transcript.segments.length} timestamped segments, ${(wer*100).toFixed(1)}% word error rate, ${evaluation.elapsedSeconds}s including Python startup.`);
  } finally {await app.close();}
});

test('real Whisper also transcribes the bundled demo recording with stale legacy duration metadata', {timeout: 120000}, async () => {
  const origin = 'http://127.0.0.1:18747';
  const app = await createService({database: ':memory:', origin, env: {WHISPER_PYTHON: process.env.WHISPER_PYTHON ?? 'python3', WHISPER_MODEL: 'tiny.en'}});
  try {
    const session = await (await app.fetch(new Request(origin + '/api/session'))).json();
    const lectures = await (await app.fetch(new Request(origin + '/api/lectures?course=demo-course-design'))).json(), id = lectures.items[0].id;
    const response = await app.fetch(new Request(origin + '/api/lectures/' + id + '/transcribe', {method: 'POST', headers: {'content-type': 'application/json', origin, 'x-lifeos-csrf': session.csrf}, body: JSON.stringify({mutationId: crypto.randomUUID()})}));
    assert.equal(response.status, 200);
    let state;const deadline = Date.now() + 100000;
    do {
      state = await (await app.fetch(new Request(origin + '/api/lectures/' + id))).json();
      if (['completed','failed'].includes(state.transcription.job.status)) break;
      await new Promise(r => setTimeout(r, 100));
    } while (Date.now() < deadline);
    assert.equal(state.transcription.job.status, 'completed', state.transcription.job.error);
    assert.equal(state.transcript.mock, false);assert.match(state.transcript.text, /feedback/i);
    assert.ok(state.transcript.segments.every(s => s.startMs >= 0 && s.endMs <= 6000));
    assert.ok(state.transcript.segments.some(s => s.mediaEndMs > 6000), 'speech after the legacy duration is preserved');
    const last = state.transcript.segments.at(-1);
    assert.equal(transcriptSeekSeconds(last, state.clips[0].data), last.mediaStartMs / 1000);
  } finally {await app.close();}
});
