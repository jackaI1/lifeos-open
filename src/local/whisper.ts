import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {CloudStore} from '../cloud/store.mjs';
import {buildWhisperTranscript} from './whisper-transcript.mjs';
import type {WorkspaceDatabase} from './database.ts';

type Inference = (manifest: string, output: string, signal: AbortSignal) => Promise<void>;
export function pythonWhisper(python: string, model: string, language = 'en'): Inference {
  return async (manifest, output, signal) => {
    const child = spawn(python, [resolve('tools/whisper/transcribe.py'), '--manifest', manifest, '--output', output, '--model', model, '--language', language], {stdio: 'ignore'});
    const completion = new Promise<{code: number | null; failed: boolean}>(done => {
      let failed = false;
      child.once('error', () => { failed = true; });
      child.once('close', code => done({code, failed}));
    });
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const stop = () => { stopped = true; child.kill('SIGTERM'); escalation ??= setTimeout(() => child.kill('SIGKILL'), 2000); };
    const timeout = setTimeout(stop, 3600000);
    signal.addEventListener('abort', stop, {once: true});
    if (signal.aborted) stop();
    try {
      await writeFile(join(resolve(manifest, '..'), 'process.json'), JSON.stringify({owner: 'LifeOS local Whisper', pid: child.pid, startedAt: new Date().toISOString(), port: null, cleanup: `kill -TERM ${child.pid}; parent waits for exit and removes this directory`}));
      const result = await completion;
      if (result.failed) throw Error('Whisper could not start. Check WHISPER_PYTHON and docs/whisper.md.');
      if (result.code !== 0 || stopped || signal.aborted) throw Error('Whisper stopped or inference failed. Check the local model setup in docs/whisper.md, then retry.');
    } finally {
      clearTimeout(timeout); clearTimeout(escalation);
      signal.removeEventListener('abort', stop);
      // Even a filesystem error must not leave an inference process behind.
      if (child.exitCode === null && child.signalCode === null) {
        stop();
        await completion;
        clearTimeout(escalation);
      }
    }
  };
}

export function createWhisperWorker(db: WorkspaceDatabase, {python, model = 'base.en', language = 'en', infer}: {python: string; model?: string; language?: string; infer?: Inference}) {
  const store = new CloudStore(db), owner = 'local-whisper-' + randomUUID(), abort = new AbortController();
  const inference = infer ?? pythonWhisper(python, model, language);
  let pending: Promise<void> | null = null, closed = false, requested = false;
  async function work() {
    // A crashed process cannot retain a lease forever. Shutdown requeues immediately.
    await store.sql("UPDATE jobs SET status='queued',lease_owner=NULL,lease_until=NULL WHERE type='lecture-transcription' AND status='running' AND lease_until<?", Date.now()).run();
    while (!closed) {
      const job = await store.sql("UPDATE jobs SET status='running',lease_owner=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=(SELECT id FROM jobs WHERE type='lecture-transcription' AND status='queued' AND cancel_requested=0 ORDER BY created_at LIMIT 1) AND status='queued' RETURNING *", owner, Date.now() + 3660000, Date.now()).first();
      if (!job) break;
      let scratch: string | undefined;
      try {
        const payload = JSON.parse(job.payload), clips: any[] = [], paths: string[] = [];
        scratch = await mkdtemp(join(tmpdir(), 'lifeos-whisper-'));
        for (const [i, reference] of payload.clips.entries()) {
          if (closed) throw Error('Worker stopping');
          const clip = await store.get('lecture-clip', reference.id), manifest = await store.get('upload-manifest', reference.id);
          if (!clip || clip.version !== reference.version || clip.data.lectureId !== payload.lectureId || clip.data.status !== 'saved' || !manifest?.data.cloudChunks) throw Error('Saved audio changed or is unavailable locally. Save audio and request transcription again.');
          const chunks = (await store.sql('SELECT c.*,o.content FROM chunks c LEFT JOIN local_objects o ON o.id=c.drive_id WHERE c.session_id=? ORDER BY c.chunk_index LIMIT 3', reference.id).all()).results;
          if (!chunks.length || chunks.length !== manifest.data.totalChunks || chunks.length > 2) throw Error('Audio chunks are incomplete.');
          const buffers: Buffer[] = [];
          for (const [index, c] of chunks.entries()) {
            if (!c.content || c.chunk_index !== index || c.size > 8 * 1024 * 1024 || c.size !== c.content.length || createHash('sha256').update(c.content).digest('hex') !== c.sha256) throw Error('Local audio checksum verification failed.');
            buffers.push(Buffer.from(c.content));
          }
          const path = join(scratch, `clip-${i}.audio`);
          await writeFile(path, Buffer.concat(buffers), {mode: 0o600});
          paths.push(path); clips.push(clip.data);
        }
        const manifestPath = join(scratch, 'input.json'), outputPath = join(scratch, 'output.json');
        await writeFile(manifestPath, JSON.stringify(paths), {mode: 0o600});
        await inference(manifestPath, outputPath, abort.signal);
        if (closed) throw Error('Worker stopping');
        if ((await stat(outputPath)).size > 16 * 1024 * 1024) throw Error('Whisper output exceeds size limit.');
        const transcript = buildWhisperTranscript(payload.lectureId, clips, JSON.parse(await readFile(outputPath, 'utf8')), model);
        const before = await store.get('lecture-transcript', payload.lectureId), lecture = await store.get('lecture', payload.lectureId);
        if (!lecture) throw Error('Lecture was deleted.');
        const now = new Date().toISOString();
        await store.commit({id: 'result-' + job.id, fingerprint: {jobId: job.id}, reads: [{kind: lecture.kind, id: lecture.id, version: lecture.version}], changes: [{kind: 'lecture-transcript', id: lecture.id, before, after: {kind: 'lecture-transcript', id: lecture.id, data: {...transcript, createdAt: now}, version: (before?.version ?? 0) + 1, createdAt: before?.createdAt ?? now, updatedAt: now}, actor: 'local-whisper', auditId: randomUUID()}], preconditions: [
          store.leaseAssertion(job.id, owner),
          store.assertion("SELECT NOT EXISTS(SELECT 1 FROM json_each(?) LEFT JOIN records r ON r.kind='lecture-clip' AND r.id=json_extract(value,'$.id') WHERE r.id IS NULL OR r.version!=CAST(json_extract(value,'$.version') AS INTEGER))", [JSON.stringify(payload.clips)]),
          store.assertion("SELECT COUNT(*)=? FROM records WHERE kind='lecture-clip' AND json_extract(data,'$.lectureId')=? AND json_extract(data,'$.status')='saved'", [clips.length, lecture.id])
        ], extra: [store.sql("UPDATE jobs SET status='completed',result=?,error=NULL,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_owner=?", JSON.stringify({segments: transcript.segments.length, clips: clips.length, engine: 'faster-whisper', mock: false}), Date.now(), job.id, owner)], result: {saved: true}} as any);
      } catch (error) {
        await store.sql("UPDATE jobs SET status=?,error=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_owner=?", closed ? 'queued' : 'failed', closed ? null : error instanceof Error ? error.message.slice(0,400) : 'Local transcription failed. Retry from Transcript.', Date.now(), job.id, owner).run();
      } finally {
        if (scratch) await rm(scratch, {recursive: true, force: true});
      }
    }
  }
  return {
    kick() {
      if (!closed) {
        requested = true;
        pending ??= (async () => { do { requested = false; await work(); } while (requested && !closed); })().finally(() => { pending = null; });
      }
      return pending ?? Promise.resolve();
    },
    async close() { closed = true; abort.abort(); await pending; }
  };
}
