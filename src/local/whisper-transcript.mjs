export function buildWhisperTranscript(lectureId, clips, output, model) {
  if (!Array.isArray(output) || output.length !== clips.length) throw Error('Whisper returned an incomplete recording.');
  const segments = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i], result = output[i], span = clip.endMs - clip.startMs;
    if (!(span > 0) || !Number.isFinite(result.duration) || result.duration <= 0 || !Array.isArray(result.segments)) throw Error('Invalid Whisper timing.');
    const durationMs = clip.mediaDurationMs ?? result.duration * 1000;
    if (!(durationMs > 0) || !Number.isFinite(durationMs)) throw Error('Invalid audio duration.');
    for (const s of result.segments) {
      if (!Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end <= s.start || s.start * 1000 >= durationMs || typeof s.text !== 'string' || s.text.length > 10000) throw Error('Invalid Whisper segment.');
      const text = s.text.trim();
      if (!text) continue;
      const startMs = Math.round(clip.startMs + s.start * 1000 / durationMs * span);
      const endMs = Math.min(clip.endMs, Math.round(clip.startMs + s.end * 1000 / durationMs * span));
      if (endMs <= startMs) continue;
      segments.push({clipId: clip.id, startMs, endMs, text});
      if (segments.length > 100000) throw Error('Transcript exceeds segment limit.');
    }
  }
  segments.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const transcript = {lectureId, engine: 'faster-whisper', model, mock: false, sourceClipIds: clips.map(c => c.id), segments, text: segments.map(s => s.text).join(' ')};
  if (Buffer.byteLength(JSON.stringify(transcript)) > 8 * 1024 * 1024) throw Error('Transcript exceeds size limit.');
  return transcript;
}
