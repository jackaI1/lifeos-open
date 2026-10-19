import {summarizePrayer,suppressRecognitionLoops} from './local-prayer-summary.mjs';
import { createHash } from 'node:crypto';
import {runLocalProgram} from '../runtime/local-program.mjs';
import {withLocalInference,LocalInferenceSettledFailure} from '../runtime/local-inference-gate.mjs';
import {constants as fsConstants} from 'node:fs';
import { mkdtemp, open, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import {prayerVocabulary} from '../../public/prayer-tree.js';
import {repairPrayerTranscript} from './local-prayer-repair.mjs';
import { PRAYER_SECTIONS } from '../domain/defaults.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const heading = value => value.trim().toLowerCase().replace(/[:()]/g, '').replace(/\s+/g, ' ');
const sectionByHeading = new Map(PRAYER_SECTIONS.flatMap(s => [[heading(s.title), s.id], [heading(`${s.title} ${s.context ?? ''}`), s.id]]));

/** Exact source spans remain private. Weekday headings govern following lines until the next heading. */
export function importPrayerNotes({ text, sourceId, sourceRevision = null, retrievedAt = null }) {
  if (typeof text !== 'string' || !sourceId || text.length > 2_000_000) throw new TypeError('A bounded prayer source and source ID are required');
  const lines = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(m => m[0]);
  const boundaries = lines.map(m => ({ start: m.index, raw: m[0], section: sectionByHeading.get(heading(m[0])) })).filter(x => x.section);
  const records = [], occurrences = new Map();
  const add = (section, start, end, weekday = null, basis = null) => {
    const rawText = text.slice(start, end);
    if (!rawText.trim()) return;
    const identity = digest(JSON.stringify([sourceId, section, weekday, rawText]));
    const occurrence = (occurrences.get(identity) ?? 0) + 1; occurrences.set(identity, occurrence);
    records.push({ kind: 'prayer-note', id: `prayer-${identity.slice(0, 24)}-${occurrence}`, data: {
      section, title: weekday === null ? PRAYER_SECTIONS.find(s => s.id === section).title : weekdays[weekday],
      text: rawText.trim(), rawText, archived: false, weekday, rotation: weekday === null ? null : 'weekly',
      rotationBasis: basis, people: [], peopleInterpretation: 'Names and relationships remain in the exact note text; no identity was inferred.',
      source: { sourceId, sourceRevision, retrievedAt, sha256: digest(text), span: { start, end }, contentHash: digest(rawText) },
      reviewFlags: section === 'regular-others' && weekday === null ? ['No explicit weekday; show on every day pending review.'] : [],
      completionEvidence: null
    } });
  };
  for (let i = 0; i < boundaries.length; i++) {
    const block = boundaries[i], end = boundaries[i + 1]?.start ?? text.length;
    if (block.section !== 'regular-others') { add(block.section, block.start, end); continue; }
    const markers = lines.filter(m => m.index >= block.start && m.index < end).map(m => {
      const match = m[0].replace(/^\s*[-⁃•]\s*/, '').trim().match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s*:/i);
      return match ? { start: m.index, day: weekdays.findIndex(d => d.toLowerCase() === match[1].toLowerCase()) } : null;
    }).filter(Boolean);
    if (!markers.length) { add(block.section, block.start, end); continue; }
    const prelude = text.slice(block.start + block.raw.length, markers[0].start);
    if (prelude.trim()) add(block.section, block.start, markers[0].start);
    markers.forEach((marker, j) => add(block.section, marker.start, markers[j + 1]?.start ?? end, marker.day, 'explicit-weekday-heading-with-following-source-lines'));
  }
  return { schemaVersion: 1, records, source: { sourceId, sourceRevision, retrievedAt, sha256: digest(text), rawText: text, preamble: text.slice(0, boundaries[0]?.start ?? text.length) }, missingSections: PRAYER_SECTIONS.filter(s => !records.some(r => r.data.section === s.id)).map(s => s.id), delete: [] };
}

export function mergePrayerNote(existing, imported) {
  if (!existing) return imported;
  if (existing.id !== imported.id || existing.kind !== 'prayer-note') throw new Error('Prayer source identity mismatch');
  return { ...imported, data: { ...imported.data, ...existing.data, source: imported.data.source } };
}

/** Retention authorization is an explicit caller decision with verified local and remote hashes. */
export function prayerRetention({ createdByLifeOS = false, processingComplete = false, seriousUncertainty = true, humanReviewed = false, artifacts = {} } = {}) {
  const reasons = [];
  if (!createdByLifeOS) reasons.push('The recording is not a new LifeOS capture.');
  if (!processingComplete) reasons.push('Processing is incomplete.');
  if (seriousUncertainty || !humanReviewed) reasons.push('Transcript uncertainty or review remains.');
  for (const name of ['transcript', 'journal']) {
    const a = artifacts[name];
    if (!a?.durable || !/^[a-f0-9]{64}$/.test(a.sha256 ?? '') || a.readbackSha256 !== a.sha256 || !a.archiveId) reasons.push(`${name} requires durable storage and matching archive read-back.`);
  }
  return { rawRetention: reasons.length ? 'retain' : 'eligible-for-cleanup', mayDeleteLifeOSRaw: reasons.length === 0, reasons, completionChanged: false };
}

function validSection(value) { return typeof value === 'number' ? PRAYER_SECTIONS[value]?.id ?? null : PRAYER_SECTIONS.some(s => s.id === value) ? value : null; }

/** Conservative extractive journal. Planned cards are never evidence of spoken prayer. */
export function structurePrayerTranscript({ recognition, sectionMarkers = [], plannedNotes = [], confidenceThreshold = 0.8 }) {
  if (!recognition || !Array.isArray(recognition.segments)) throw new TypeError('Recognition segments are required');
  const flags = ['Machine transcript needs review, particularly personal names.'];
  const markers = [];
  for (const marker of sectionMarkers) {
    const section = validSection(marker.section), atMs = marker.atMs;
    if (!section || !Number.isFinite(atMs) || atMs < 0 || markers.length && atMs < markers.at(-1).atMs) { flags.push('Invalid or out-of-order section marker was ignored.'); continue; }
    markers.push({ section, atMs });
  }
  const sections = PRAYER_SECTIONS.map(s => ({ ...s, actualSpoken: [], plannedRequests: plannedNotes.filter(n => (n.data ?? n).section === s.id).map(n => ({ id: n.id ?? null, text: (n.data ?? n).text ?? '', evidence: 'planned-only' })) }));
  const unassigned = [], full = [], edits = [];
  for (const segment of recognition.segments) {
    const words = segment.words?.length ? segment.words : String(segment.text ?? '').trim().split(/\s+/).filter(Boolean).map(word => ({ word, start: null, end: null, conf: null }));
    let group = null;
    for (const word of words) {
      if (!word.word) continue;
      if (/^(um+|uh+)$/i.test(word.word) && word.conf >= confidenceThreshold) { edits.push({ operation: 'remove-filler', raw: word.word, start: word.start, end: word.end }); continue; }
      const uncertain = !Number.isFinite(word.conf) || word.conf < confidenceThreshold;
      const clean = word.word;
      if(uncertain)edits.push({operation:'uncertain-recognition',raw:word.word,start:word.start,end:word.end,confidence:word.conf??null});
      if (uncertain) flags.push('Some recognized words have low confidence; original recognition is retained.');
      const time = Number.isFinite(word.start) ? word.start * 1000 : null;
      const marker = time === null ? null : markers.filter(m => m.atMs <= time).at(-1);
      const id = marker?.section ?? null;
      if (!group || group.section !== id) {
        group = { section: id, text: '', startSeconds: word.start ?? null, endSeconds: word.end ?? null, evidence: 'recognized-audio', uncertain: false };
        (sections.find(s => s.id === id)?.actualSpoken ?? unassigned).push(group);
      }
      group.text += `${group.text ? ' ' : ''}${clean}`; group.endSeconds = word.end ?? group.endSeconds; group.uncertain ||= uncertain;
      full.push(clean);
    }
  }
  if (unassigned.length) flags.push('Audio without a reliable section marker remains unassigned.');
  const cleanedTranscript = full.join(' ');
  if (!cleanedTranscript) flags.push('No intelligible speech was recognized.');
  return { schemaVersion: 1, rawTranscript: recognition.segments.map(s => s.text ?? '').filter(Boolean).join('\n'), cleanedTranscript, edits, sections, unassigned, qualityFlags: [...new Set(flags)], seriousUncertainty: true, humanReviewed: false, summaryMethod: 'extractive-spoken-bullets', prayerComplete: null };
}

async function contained(root, target) {
  const base = await realpath(root), path = await realpath(target), rel = relative(base, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Audio path is outside its private storage directory');
  return path;
}
const checkProcessingSignal=signal=>{if(signal?.aborted)throw Object.assign(Error('local_inference_aborted'),{code:'local_inference_aborted'});};
const recognitionFailure=()=>new LocalInferenceSettledFailure('local_recognition_failed');
function parseNativeRecognition(text,convert=value=>value){
  try{
    const result=convert(JSON.parse(text));
    if(!result||!Array.isArray(result.segments)||result.segments.length>100000||!Number.isFinite(result.durationSeconds)||result.durationSeconds<0||result.durationSeconds>7201)throw recognitionFailure();
    return result;
  }catch{throw recognitionFailure();}
}
async function readNativeRecognition(path){
  let handle;
  try{
    handle=await open(path,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);
    const before=await handle.stat(),limit=32*1024*1024;
    if(!before.isFile()||before.uid!==process.getuid()||before.size<1||before.size>limit)throw recognitionFailure();
    const bytes=Buffer.alloc(before.size+1);let count=0;
    while(count<bytes.length){const next=await handle.read(bytes,count,bytes.length-count,null);if(!next.bytesRead)break;count+=next.bytesRead;}
    const after=await handle.stat();
    if(count!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw recognitionFailure();
    return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,count));
  }catch{throw recognitionFailure();}finally{await handle?.close();}
}

const VOSK_PROGRAM = `import json, sys, wave
from vosk import Model, KaldiRecognizer, SetLogLevel
SetLogLevel(-1)
with wave.open(sys.argv[1], 'rb') as w:
 if w.getnchannels()!=1 or w.getsampwidth()!=2 or w.getframerate()!=16000: raise ValueError('PCM format')
 duration=w.getnframes()/w.getframerate()
 if duration>7200: raise ValueError('Recording duration exceeds limit')
 rec=KaldiRecognizer(Model(sys.argv[2]),16000); rec.SetWords(True); segments=[]
 def add(result):
  r=json.loads(result)
  if r.get('text'): segments.append({'text':r['text'],'words':r.get('result',[])})
 while True:
  data=w.readframes(4000)
  if not data: break
  if rec.AcceptWaveform(data): add(rec.Result())
 add(rec.FinalResult())
 print(json.dumps({'durationSeconds':duration,'segments':segments},ensure_ascii=False))
`;

/** One continuous MediaRecorder stream, split into storage chunks. Restarts need separate sessions. */
export function prayerProcessingPrefix(sessionId,fingerprint){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(sessionId??'')||! /^[a-f0-9]{64}$/.test(fingerprint??''))throw new Error('Invalid private audio processing identity');
  return `${digest(sessionId).slice(0,12)}-${fingerprint.slice(0,12)}-`;
}
export async function processPrayerAudio({ sessionId, chunks, storageRoot, outputRoot, ffmpegPath, pythonPath, modelPath, whisperPath, engine = whisperPath ? 'whisper.cpp' : 'vosk', backend = 'cpu', threads = 8, snapshotBasis = 'recording-snapshot', sectionMarkers = [], plannedNotes = [], timeoutMs = 600_000,localSummary=null,signal,runLocal=withLocalInference,runProgram=runLocalProgram,onRecognized=async()=>{} }) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(sessionId ?? '') || !Array.isArray(chunks) || !chunks.length || chunks.length > 10001) throw new Error('A bounded audio session is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new Error('Audio timeout is invalid');
  if(typeof runLocal!=='function'||typeof runProgram!=='function'||typeof onRecognized!=='function')throw new Error('Local processing configuration is invalid');
  checkProcessingSignal(signal);
  const ordered = chunks.map(c => ({ ...c, index: c.index ?? c.chunk_index, bytes: c.bytes ?? c.size })).sort((a, b) => a.index - b.index);
  if (ordered.some((c, i) => c.index !== i || !/^[a-f0-9]{64}$/.test(c.sha256 ?? '') || !Number.isSafeInteger(c.bytes) || c.bytes <= 0 || c.bytes > 8 * 1024 * 1024)) throw new Error('Audio chunks are missing, duplicated or invalid');
  if (ordered.reduce((n, c) => n + c.bytes, 0) > 1024 ** 3) throw new Error('Audio session exceeds the storage limit');
  // Resolve the existing parent before creating anything, blocking a symlink escape.
  const outputBase = await contained(storageRoot, outputRoot);
  const fingerprint = digest(JSON.stringify([ordered.map(c => [c.index, c.sha256, c.bytes]), sectionMarkers, plannedNotes]));
  const directory = await mkdtemp(join(outputBase, prayerProcessingPrefix(sessionId,fingerprint))).catch(()=>{throw new Error('Local prayer storage is unavailable or exceeds its filesystem path limit; raw audio retained');});
  await contained(storageRoot, directory);
  const input = join(directory, 'recording.media'), wav = join(directory, 'decoded.wav');
  let joined;
  try {
    joined = await open(input, 'wx',0o600);
    for (const chunk of ordered) {
      const path = await contained(storageRoot, chunk.path), info = await stat(path);
      if (!info.isFile() || info.size !== chunk.bytes) throw new Error('Stored audio chunk size does not match');
      const bytes = await readFile(path);
      if (digest(bytes) !== chunk.sha256) throw new Error('Stored audio checksum does not match');
      await joined.writeFile(bytes);
    }
    await joined.sync();
  } finally { await joined?.close(); }
  checkProcessingSignal(signal);
  await runProgram(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'matroska,webm,mov,ogg,wav', '-i', input, '-map', '0:a:0', '-vn', '-sn', '-dn', '-t', '7201', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { timeoutMs });
  checkProcessingSignal(signal);
  const started=Date.now(),prompt=prayerVocabulary(plannedNotes);let recognition;
  if(engine==='whisper.cpp'){
    const base=join(directory,'whisper'),args=['-m',await realpath(modelPath),'-f',wav,'-l','en','-mc','0','--prompt',prompt,'-ojf','-of',base,'-t',String(Math.min(12,Math.max(1,threads))),...(backend==='cpu'?['-ng']:[])];
    await runLocal({priority:'private',signal},()=>runProgram(whisperPath,args,{timeoutMs,maxOutput:4000000}));
    recognition=parseNativeRecognition(await readNativeRecognition(base+'.json'),whisperRecognition);
  }else{
    const args=['-c',VOSK_PROGRAM,wav,await realpath(modelPath)];
    const native=await runLocal({priority:'private',signal},()=>runProgram(pythonPath,args,{timeoutMs}));
    recognition=parseNativeRecognition(native);
  }
  const provenance={engine,model:engine==='whisper.cpp'?'large-v3-turbo':'vosk-small-en-us-0.15',backend,processingMs:Date.now()-started,prompt,promptSha256:digest(prompt),snapshotBasis,noteRevisions:plannedNotes.map(n=>({id:n.id,version:n.version??null})),cleanupProvider:'deterministic-normalization'};
  let result = structurePrayerTranscript({ recognition, sectionMarkers, plannedNotes,confidenceThreshold:engine==='whisper.cpp'?0.5:0.8 });
  const normalized=await repairPrayerTranscript({rawTranscript:result.cleanedTranscript});result.cleanedTranscript=normalized.text;result.provenance=provenance;
  const loop=suppressRecognitionLoops(result.cleanedTranscript);result.cleanedTranscript=loop.text;for(const s of result.sections)for(const p of s.actualSpoken)p.text=suppressRecognitionLoops(p.text).text;if(loop.removed)result.qualityFlags.push('Repeated recognition loop compressed for display; original audio and ASR preserved.');
  const transcriptText = result.cleanedTranscript, journalText = renderPrayerJournal(result);
  const artifacts = {};
  async function saveArtifact(file,content){
    const path=join(directory,file),handle=await open(path,'wx',0o600);
    try{await handle.writeFile(content,'utf8');await handle.sync();}finally{await handle.close();}
    const sha256=digest(content);if(digest(await readFile(path))!==sha256)throw new Error('Audio output read-back mismatch');
    return {path,sha256,durable:true,archiveId:null,readbackSha256:null};
  }
  for (const [name, content, file] of [['transcript', transcriptText, 'transcript.txt'], ['journal', journalText, 'journal.md'], ['recognition', JSON.stringify(recognition, null, 2), 'recognition.json']]) {
    artifacts[name]=await saveArtifact(file,content);
  }
  const checkpoint={...result,recognition,sessionId,durationSeconds:recognition.durationSeconds,artifacts:structuredClone(artifacts),sourceFingerprint:fingerprint,retention:prayerRetention(),processingStatus:'recognized-needs-summary',completionChanged:false};
  await saveArtifact('recognized-result.json',JSON.stringify(checkpoint));
  await onRecognized(structuredClone(checkpoint));
  // Completed recognition survives a later optional-model defer or cancellation.
  checkProcessingSignal(signal);
  if(localSummary?.enabled){
    result=await summarizePrayer(result,{...localSummary,signal,runLocal});
    artifacts.journal=await saveArtifact('journal-summary.md',renderPrayerJournal(result));
  }
  checkProcessingSignal(signal);
  const output = { ...result, recognition, sessionId, durationSeconds: recognition.durationSeconds, artifacts, sourceFingerprint: fingerprint, retention: prayerRetention(), processingStatus: 'transcribed-needs-review', completionChanged: false };
  const saved = await open(join(directory, 'result.json'), 'wx',0o600);
  try { await saved.writeFile(JSON.stringify(output, null, 2)); await saved.sync(); } finally { await saved.close(); }
  return output;
}

export function renderPrayerJournal(result) {
  const lines = ['# Prayer journal', '', 'Machine transcript, pending correction. Prayer completion is recorded separately.', ''];
  for (const section of result.sections) {
    lines.push(`## ${section.title}`, '', 'Recognized speech', '');
    if(section.summary?.length)lines.push(...section.summary.map(p=>'- '+p.text),'','Recognized speech','');
    lines.push(...(section.actualSpoken.length ? section.actualSpoken.map(s => `- ${s.text}`) : ['No speech assigned to this section.']));
    if (section.plannedRequests.length) lines.push('', 'Planned requests, not evidence of what was said', '', ...section.plannedRequests.map(n => `- ${n.text.replace(/\n/g, '\n  ')}`));
    lines.push('');
  }
  if (result.unassigned.length) lines.push('## Unassigned speech', '', ...result.unassigned.map(s => `- ${s.text}`), '');
  lines.push('## Review notes', '', ...result.qualityFlags.map(f => `- ${f}`)); return lines.join('\n');
}

export function whisperRecognition(native){
 const segments=(native.transcription??[]).map(s=>{const words=[];for(const t of s.tokens??[]){if(/^\[_/.test(t.text??''))continue;const text=t.text??'';if(!text.trim())continue;let word=words.at(-1);if(!word||/^\s/.test(text)){word={word:text.trim(),start:t.offsets?.from>=0?t.offsets.from/1000:(s.offsets?.from??0)/1000,end:t.offsets?.to>=0?t.offsets.to/1000:(s.offsets?.to??0)/1000,conf:Number.isFinite(t.p)?t.p:null};words.push(word);}else{word.word+=text;word.end=t.offsets?.to>=0?t.offsets.to/1000:word.end;if(/[\p{L}\p{N}]/u.test(text)&&Number.isFinite(t.p))word.conf=word.conf===null?t.p:Math.min(word.conf,t.p);}}if(!words.length)words.push({word:(s.text??'').trim(),start:(s.offsets?.from??0)/1000,end:(s.offsets?.to??0)/1000,conf:null});return{text:s.text??'',words};});return{durationSeconds:Math.max(0,...(native.transcription??[]).map(s=>(s.offsets?.to??0)/1000)),segments,engine:'whisper.cpp'};
}
