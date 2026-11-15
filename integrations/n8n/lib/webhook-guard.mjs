// Webhook guard for the LifeOS n8n workflow. It has no imports on purpose: the build
// step copies this file into the n8n Code node, so it must run as plain JavaScript
// with only Web Crypto (globalThis.crypto.subtle) and TextEncoder available.

export const GUARD_LIMITS = Object.freeze({
  toleranceSeconds: 300,
  replayWindowMs: 24 * 60 * 60 * 1000,
  maxBodyBytes: 8192,
  dueWindowMs: 24 * 60 * 60 * 1000,
  attempts: 4,
  baseDelayMs: 500,
  logEntries: 50,
});
export const EVENT_TYPES = Object.freeze(['deadline.due-soon', 'calendar.changed']);

const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');

/** HMAC-SHA256 over "<timestamp>.<raw body>", returned as lowercase hex. */
export async function hmacHex(subtle, secret, message) {
  const key = await subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return hex(await subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

export async function signBody(subtle, secret, timestamp, rawBody) {
  return `sha256=${await hmacHex(subtle, secret, `${timestamp}.${rawBody}`)}`;
}

/** Compare every character so the answer does not depend on where a guess first differs. */
export function sameSignature(expected, given) {
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return difference === 0;
}

const fail = (status, reason) => ({ok: false, status, reason});

/** Returns {ok: true, event} or {ok: false, status, reason}. Malformed input never reaches the reminder step. */
export function parseEvent(rawBody, now) {
  let event;
  try { event = JSON.parse(rawBody); } catch { return fail(400, 'Body is not JSON'); }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return fail(422, 'Body must be an object');
  if (!EVENT_TYPES.includes(event.type)) return fail(422, 'Unknown event type');
  if (typeof event.id !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(event.id)) return fail(422, 'Event id is missing or malformed');
  if (typeof event.title !== 'string' || !event.title.trim() || event.title.length > 200) return fail(422, 'Title is missing or longer than 200 characters');
  if (typeof event.dueAt !== 'string' || !Number.isFinite(Date.parse(event.dueAt))) return fail(422, 'dueAt must be an ISO time');
  const due = Date.parse(event.dueAt);
  if (event.type === 'deadline.due-soon' && Math.abs(due - now) > GUARD_LIMITS.dueWindowMs) return fail(422, 'A due-soon deadline must be within 24 hours');
  if (event.changedFields !== undefined && (!Array.isArray(event.changedFields) || event.changedFields.length > 10 || event.changedFields.some(f => typeof f !== 'string' || f.length > 40))) {
    return fail(422, 'changedFields must be a short list of names');
  }
  return {ok: true, event};
}

/** Replay memory: an event id is refused for 24 hours after it was accepted. */
export function createSeenStore(state = {}) {
  return {
    has(id, now) {
      const until = state[id];
      if (until === undefined) return false;
      if (until <= now) { delete state[id]; return false; }
      return true;
    },
    add(id, now) {
      state[id] = now + GUARD_LIMITS.replayWindowMs;
      for (const key of Object.keys(state)) if (state[key] <= now) delete state[key];
    },
  };
}

/** Check headers, signature, timestamp, body, then replay, in that order. */
export async function verifyDelivery({subtle, secret, headers, rawBody, now, seen}) {
  if (!secret) return fail(500, 'Webhook secret is not configured');
  if (typeof rawBody !== 'string' || new TextEncoder().encode(rawBody).length > GUARD_LIMITS.maxBodyBytes) return fail(413, 'Body is missing or larger than 8 KB');
  const timestamp = headers['x-lifeos-timestamp'];
  if (typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp)) return fail(401, 'Timestamp header is missing or malformed');
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > GUARD_LIMITS.toleranceSeconds) return fail(401, 'Timestamp is outside the five-minute window');
  const expected = await signBody(subtle, secret, timestamp, rawBody);
  if (!sameSignature(expected, headers['x-lifeos-signature'])) return fail(401, 'Signature does not match');
  const parsed = parseEvent(rawBody, now);
  if (!parsed.ok) return parsed;
  if (seen.has(parsed.event.id, now)) return fail(409, 'This event was already accepted (replay)');
  return {ok: true, status: 202, event: parsed.event};
}

export function buildReminder(event) {
  const prefix = event.type === 'deadline.due-soon' ? 'Due soon' : 'Changed';
  return {type: 'lifeos.reminder', eventId: event.id, title: `${prefix}: ${event.title}`, dueAt: event.dueAt};
}

const retryable = status => status === 0 || status === 408 || status === 429 || status >= 500;

/** Exponential backoff: 500 ms, 1 s, 2 s. Client errors (other than 408 and 429) are not retried. */
export async function deliverWithRetry({send, sleep, attempts = GUARD_LIMITS.attempts, baseDelayMs = GUARD_LIMITS.baseDelayMs}) {
  let reason = 'no attempt made';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let status = 0;
    try { status = Number(await send(attempt)) || 0; } catch { status = 0; }
    if (status >= 200 && status < 300) return {delivered: true, attempts: attempt, status};
    reason = status ? `HTTP ${status}` : 'network error';
    if (!retryable(status)) return {delivered: false, attempts: attempt, status, reason};
    if (attempt < attempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
  }
  return {delivered: false, attempts, reason};
}
