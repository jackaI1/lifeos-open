// This view uses saved receipts and current server records, never prayer completion.
export function recordingStatus({ local, pending = [], record, job } = {}) {
  const data = record?.data ?? record;
  const saved = data?.uploadStatus === 'stored' || local?.state === 'uploaded';
  const transcript = data?.transcriptText || data?.cleanedTranscript || data?.transcript;
  const archive = data?.archiveStatus === 'archived';
  let label;
  if (saved) {
    if (transcript) label = archive ? data.humanReviewed === true ? 'Prayer journal ready. Transcript reviewed.' : 'Prayer journal ready. Transcript needs your review.' : data.archiveStatus === 'failed' ? 'Transcribed. Journal archive failed.' : 'Transcribed. Journal archive pending.';
    else if (job?.status === 'failed' || job?.status === 'needs-input') label = 'Transcription needs attention';
    else if (job?.status === 'running') label = 'Transcribing on your computer';
    else if (job?.status === 'cancelled') label = 'Transcription cancelled. Audio retained.';
    else if (job?.status === 'completed') label = 'Processing finished without an available transcript. Audio retained.';
    else label = job?.progress === 'waiting for computer' ? 'Waiting for your computer to transcribe' : 'Waiting for transcription';
  } else if (pending.some(item => item.error) || local?.lastError) label = 'Upload not complete. Retry available.';
  else if (local?.state === 'recording') label = 'Captured audio can be recovered from this browser';
  else if (pending.length) label = 'Captured on this device. Upload pending.';
  else if (local) label = 'Cloud finalization not confirmed. Retry available.';
  else label = transcript ? 'Transcript available. Audio save not confirmed.' : 'No saved recording found';
  return {
    label, saved, transcript: Boolean(transcript), archive,
    captured: Boolean(local?.chunks > 0),
    localCopy: pending.length ? `${pending.length} audio chunks retained in this browser` : local ? 'No unsent audio chunks in this browser. Uploaded chunks may be in LifeOS.' : 'This browser cannot inspect audio stored on another device.',
    error: job?.error || pending.find(item => item.error)?.error || local?.lastError || null,
  };
}
