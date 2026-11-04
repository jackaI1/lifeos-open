import {AppError} from '../shared/errors.mjs';
import {digest} from './store.mjs';
import * as v from '../server/validation.mjs';

export async function transcriptionState(store, env, lectureId) {
  const job = await store.sql("SELECT id,status,error,progress FROM jobs WHERE type='lecture-transcription' AND json_extract(payload,'$.lectureId')=? ORDER BY created_at DESC,id DESC LIMIT 1", lectureId).first();
  return {available: !!env.LOCAL_WHISPER, job};
}

export async function requestTranscription({store, env, req, id, json}) {
  if (req.method !== 'POST') throw new AppError('Method not allowed', 405);
  if (!env.LOCAL_WHISPER) throw new AppError('Local Whisper is not configured. See docs/whisper.md for setup.', 503);
  const lecture = await store.get('lecture', v.identifier(id));
  if (!lecture) throw new AppError('Lecture not found', 404);
  const b = await json(req);
  v.exactFields(b, ['mutationId']);
  const mid = v.mutationId(b.mutationId), fingerprint = {lectureId: id, b};
  const previous = await store.mutation(mid, await digest(JSON.stringify(fingerprint)));
  if (previous) return Response.json(previous);
  const active = await store.sql("SELECT id,status FROM jobs WHERE type='lecture-transcription' AND json_extract(payload,'$.lectureId')=? AND status IN ('queued','running') LIMIT 1", id).first();
  if (active) return Response.json(await store.commit({id: mid, fingerprint, result: {job: active}}));
  const clips = (await store.sql("SELECT id,version FROM records WHERE kind='lecture-clip' AND json_extract(data,'$.lectureId')=? AND json_extract(data,'$.status')='saved' ORDER BY id LIMIT 501", id).all()).results;
  if (!clips.length) throw new AppError('Pause recording and save audio before transcribing.', 409);
  if (clips.length > 500) throw new AppError('A transcription supports at most 500 saved audio segments.', 413);
  const jobId = 'whisper-' + (await digest(mid)).slice(0, 40);
  return Response.json(await store.commit({id: mid, fingerprint, reads: [{kind: lecture.kind, id, version: lecture.version}],
    jobs: [{id: jobId, type: 'lecture-transcription', component: 'local-whisper', authority: 'owner-lecture', payload: {lectureId: id, clips}}],
    result: {job: {id: jobId, status: 'queued'}}}));
}
