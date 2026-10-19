// A deliberate update is a save transaction, never a blind reload.
export async function pullLectureUpdate({checkRelease,wasRecording,pause,resume,checkpoint,saveResume,reload}) {
  const release = await checkRelease();
  if (!/^[a-f0-9]{7,40}$/.test(release?.commit ?? '')) throw Error('The latest app could not be checked. Your lecture is still open.');
  let paused = false;
  try {
    if (wasRecording) { paused = true; await pause(); }
    const state = await checkpoint();
    await saveResume({...state, resumeRecording:wasRecording, release:release.commit, at:Date.now()});
    await reload();
    return release;
  } catch (error) {
    if (paused) try { await resume(); } catch { throw Error(error.message + ' Your notes remain here. Tap Record to resume the microphone.'); }
    throw error;
  }
}
export function validLectureResume(value, id, now=Date.now()) {
  return value?.lectureId===id && Number.isFinite(value.at) && now-value.at>=0 && now-value.at<30*60*1000 ? value : null;
}
