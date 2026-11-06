import http from 'node:http';
import {verify} from './signature.js';
export function createApp(pool, secret) {
 return http.createServer(async (req,res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks') {res.writeHead(404).end(); return;}
  let chunks=[], size=0, outcome='invalid', id=null, detail=null;
  try {
   for await (const chunk of req) { size += chunk.length; if (size > 1024*1024) {outcome='too_large'; throw new Error('body too large');} chunks.push(chunk); }
   const body=Buffer.concat(chunks);
   if (!verify(body, req.headers['stripe-signature'], secret)) {outcome='bad_signature'; throw new Error('invalid signature');}
   let event; try {event=JSON.parse(body.toString());} catch {throw new Error('invalid JSON');}
   if (!event || typeof event.id !== 'string' || !event.id || event.id.length > 255 || typeof event.type !== 'string' || !event.data || typeof event.data !== 'object') throw new Error('invalid event');
   id=event.id; outcome='error';
   const client=await pool.connect();
   try { await client.query('BEGIN');
    const inserted=await client.query('INSERT INTO events(id,type,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',[id,event.type,event]);
    outcome=inserted.rowCount ? 'accepted' : 'duplicate';
    await client.query('INSERT INTO deliveries(event_id,outcome) VALUES($1,$2)',[id,outcome]);
    await client.query('COMMIT');
   } catch(e) {await client.query('ROLLBACK'); throw e;} finally {client.release();}
   res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({outcome}));
  } catch(e) {
   detail=e.message;
   if (!['bad_signature','too_large','invalid'].includes(outcome)) outcome='error';
   // A database outage cannot be logged in that same database; return 500 so the sender retries.
   try {await pool.query('INSERT INTO deliveries(event_id,outcome,detail) VALUES($1,$2,$3)',[id,outcome,detail]);} catch {outcome='error';}
   res.writeHead(outcome==='error'?500:outcome==='too_large'?413:400).end(outcome);
  }
 });
}
