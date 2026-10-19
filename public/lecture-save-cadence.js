// Device ink persistence is immediate. Only remote page revisions are coalesced.
export const LECTURE_CLOUD_SAVE_MS = 30000;
export function lectureSaveDelay(lastAttempt, now, retryAt = 0) {
  return Math.max(0, LECTURE_CLOUD_SAVE_MS - (now - lastAttempt), retryAt - now);
}
