// Whisper timestamps are in media seconds. Ink uses the shared lecture clock.
export function transcriptSeekSeconds(segment, clip) {
  const duration = clip.mediaDurationMs ?? clip.endMs - clip.startMs;
  return Math.max(0, Math.min(duration, (segment.startMs - clip.startMs) * duration / (clip.endMs - clip.startMs))) / 1000;
}

export function nearestTranscriptNote(segment, pages) {
  let nearest = null, distance = Infinity;
  for (const [pageId, page] of pages) for (const stroke of page?.strokes ?? []) {
    if (stroke.hidden || stroke.audioSegmentId !== segment.clipId) continue;
    const delta = Math.abs(stroke.startedAtOffsetMs - segment.startMs);
    if (delta < distance) { distance = delta; nearest = {pageId, strokeId: stroke.id}; }
  }
  // Don't imply that notes minutes away are about this sentence.
  return distance <= 30000 ? nearest : null;
}
