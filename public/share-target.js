// Shared-item inbox for the phone's share sheet.
// The service worker (sw.js) stores what another app shares; this module reads it
// back, turns it into a study note draft and clears it only after the note is saved.
// Nothing here touches the DOM, so the rules are also tested in Node.

export const SHARE_DB = 'lifeos-share-inbox';
export const SHARE_STORE = 'items';
export const SHARE_KEY = 'latest';
export const SHARE_LIMITS = { title: 200, text: 6000, url: 2048 };

const STUDY_NOTE_KIND = 'concept';

export function cleanSharedText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').trim().slice(0, max);
}

// Only web links are kept. A share from an unknown app could carry a javascript: or file: link.
export function safeSharedUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href.slice(0, SHARE_LIMITS.url);
  } catch {
    return '';
  }
}

// Body text for the note: the shared text first, then the link on its own line.
export function sharedText(item) {
  const url = safeSharedUrl(item?.url);
  const room = SHARE_LIMITS.text - (url ? url.length + 2 : 0);
  return [cleanSharedText(item?.text, room), url].filter(Boolean).join('\n\n');
}

// Title the form starts with: the shared title, else the first line of the text.
export function sharedTitle(item) {
  const title = cleanSharedText(item?.title, SHARE_LIMITS.title);
  if (title) return title;
  const firstLine = sharedText(item).split('\n')[0].slice(0, 80);
  return firstLine || 'Shared from my phone';
}

// The exact record the learning-notes API accepts (see src/cloud/learning-notes.mjs).
export function studyNoteData({ courseId, title, text }) {
  const cleanTitle = cleanSharedText(title, SHARE_LIMITS.title);
  if (typeof courseId !== 'string' || !courseId) throw new Error('Choose a course for this note.');
  if (!cleanTitle) throw new Error('Give the note a title.');
  return {
    type: STUDY_NOTE_KIND,
    courseId,
    title: cleanTitle,
    text: cleanSharedText(text, SHARE_LIMITS.text),
    misunderstanding: '',
    reasoning: '',
    status: 'unreviewed',
    linkedIds: [],
  };
}

// Stores the newest item as-is. Raw values are length-limited; the form re-checks them.
export function openShareInbox(indexedDBImpl = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDBImpl.open(SHARE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SHARE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function peekSharedItem(indexedDBImpl = globalThis.indexedDB) {
  const db = await openShareInbox(indexedDBImpl);
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(SHARE_STORE, 'readonly').objectStore(SHARE_STORE).get(SHARE_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function clearSharedItem(indexedDBImpl = globalThis.indexedDB) {
  const db = await openShareInbox(indexedDBImpl);
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE, 'readwrite');
      tx.objectStore(SHARE_STORE).delete(SHARE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
