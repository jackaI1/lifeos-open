import {createHmac, timingSafeEqual} from 'node:crypto';
export function sign(body, secret, timestamp = Math.floor(Date.now()/1000)) {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')}`;
}
export function verify(body, header, secret, now = Math.floor(Date.now()/1000), tolerance = 300) {
  if (!secret || typeof header !== 'string') return false;
  const parts = header.split(',').map(s => s.trim().split('='));
  const ts = parts.filter(([k]) => k === 't');
  if (ts.length !== 1 || !/^\d+$/.test(ts[0][1])) return false;
  const t = Number(ts[0][1]);
  if (!Number.isSafeInteger(t) || Math.abs(now-t) > tolerance) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(body).digest();
  return parts.filter(([k]) => k === 'v1').some(([,v]) => /^[a-f\d]{64}$/i.test(v || '') && timingSafeEqual(expected, Buffer.from(v, 'hex')));
}
