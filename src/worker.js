import { canComplete, normalizePoints, POINT_COUNT, validDate } from "./domain.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const keyCache = new Map();
const base64Bytes = (value) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
};
const decode = (value) => JSON.parse(new TextDecoder().decode(base64Bytes(value)));

async function accessKey(issuer, kid) {
  const cacheKey = `${issuer}:${kid}`;
  if (keyCache.has(cacheKey)) return keyCache.get(cacheKey);
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error("Unable to load Access signing keys");
  const { keys } = await response.json();
  const jwk = keys.find((candidate) => candidate.kid === kid);
  if (!jwk) throw new Error("Unknown Access signing key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  keyCache.set(cacheKey, key);
  return key;
}

async function authenticate(request, env) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || typeof env.ACCESS_TEAM_DOMAIN !== "string" || typeof env.ACCESS_AUD !== "string" || typeof env.ALLOWED_EMAIL !== "string") return null;
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    const header = decode(encodedHeader); const payload = decode(encodedPayload);
    const issuer = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, "");
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== "RS256" || payload.iss !== issuer || !audience.includes(env.ACCESS_AUD) || payload.exp <= now || (payload.nbf && payload.nbf > now)) return null;
    const signature = base64Bytes(encodedSignature);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", await accessKey(issuer, header.kid), signature, new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));
    const email = valid && typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    return email && email === env.ALLOWED_EMAIL.toLowerCase() ? email : null;
  } catch { return null; }
}

function fromRow(row) { return { date: row.entry_date, points: JSON.parse(row.points_json), complete: row.devotional_complete === 1, version: row.version, updatedAt: row.updated_at }; }
function empty(date) { return { date, points: Array(POINT_COUNT).fill(""), complete: false, version: 0, updatedAt: null }; }

async function api(request, env, user) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/devotionals") {
    const rows = await env.DB.prepare("SELECT entry_date, points_json, devotional_complete, version, updated_at FROM devotional_entries WHERE user_id = ? ORDER BY entry_date DESC LIMIT 90").bind(user).all();
    return json({ entries: rows.results.map(fromRow) });
  }
  const match = url.pathname.match(/^\/api\/devotionals\/(\d{4}-\d{2}-\d{2})$/);
  if (!match || !validDate(match[1])) return json({ error: "Not found" }, 404);
  const date = match[1];
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT entry_date, points_json, devotional_complete, version, updated_at FROM devotional_entries WHERE user_id = ? AND entry_date = ?").bind(user, date).first();
    return json({ entry: row ? fromRow(row) : empty(date) });
  }
  if (request.method !== "PUT") return json({ error: "Method not allowed" }, 405);
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const points = normalizePoints(body.points);
  if (!points || typeof body.complete !== "boolean" || !Number.isInteger(body.version) || body.version < 0) return json({ error: "Invalid devotional entry" }, 400);
  if (body.complete && !canComplete(points)) return json({ error: "All seven points are required before completion" }, 400);
  const now = new Date().toISOString();
  if (body.version === 0) {
    const result = await env.DB.prepare("INSERT OR IGNORE INTO devotional_entries (user_id, entry_date, points_json, devotional_complete, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)").bind(user, date, JSON.stringify(points), body.complete ? 1 : 0, now, now).run();
    if (!result.meta.changes) return json({ error: "This entry changed on another device. Reload before saving." }, 409);
  } else {
    const result = await env.DB.prepare("UPDATE devotional_entries SET points_json = ?, devotional_complete = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND entry_date = ? AND version = ?").bind(JSON.stringify(points), body.complete ? 1 : 0, now, user, date, body.version).run();
    if (!result.meta.changes) return json({ error: "This entry changed on another device. Reload before saving." }, 409);
  }
  const saved = await env.DB.prepare("SELECT entry_date, points_json, devotional_complete, version, updated_at FROM devotional_entries WHERE user_id = ? AND entry_date = ?").bind(user, date).first();
  return json({ entry: fromRow(saved) });
}

export default { async fetch(request, env) { const user = await authenticate(request, env); if (!user) return json({ error: "Unauthorized" }, 401); return new URL(request.url).pathname.startsWith("/api/") ? api(request, env, user) : env.ASSETS.fetch(request); } };
