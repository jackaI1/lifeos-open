import {test,after} from 'node:test'; import assert from 'node:assert/strict'; import {readFile} from 'node:fs/promises'; import pg from 'pg'; import {createApp} from '../src/app.js'; import {sign,verify} from '../src/signature.js'; import {processOne} from '../src/queue.js';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
after(()=>pool.end());
test('signature checks raw bytes, time and multiple signatures',()=>{const b=Buffer.from('{"x":1}'), s=sign(b,'secret',1000); assert(verify(b,s,'secret',1000)); assert(!verify(Buffer.from('{"x": 1}'),s,'secret',1000)); assert(!verify(b,s,'secret',1301)); assert(!verify(b,'t=1000,v1=abcd','secret',1000)); assert(verify(b,s+',v1='+ '0'.repeat(64),'secret',1000));});
test('delivery, deduplication, retry, dead letter, replay and RLS',async()=>{
 await pool.query(await readFile(new URL('../db/001_schema.sql',import.meta.url),'utf8')); await pool.query('TRUNCATE audit_log,orders,dead_letters,deliveries,events RESTART IDENTITY CASCADE');
 const server=createApp(pool,'secret'); await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {
  const url=`http://127.0.0.1:${server.address().port}/webhooks`, event={id:'evt1',type:'order.created',data:{order_id:'o1',rep_id:'11111111-1111-4111-8111-111111111111',amount_cents:100}}; const body=JSON.stringify(event);
  const send=(signature,b=body)=>fetch(url,{method:'POST',headers:{'stripe-signature':signature},body:b});
  assert.equal((await send(sign(body,'wrong'))).status,400);
  assert.equal((await (await send(sign(body,'secret'))).json()).outcome,'accepted');
  assert.equal((await (await send(sign(body,'secret'))).json()).outcome,'duplicate');
  assert.equal((await pool.query('SELECT count(*)::int n FROM deliveries')).rows[0].n,3);
  assert(await processOne(pool)); assert.equal((await pool.query('SELECT status FROM events WHERE id=$1',['evt1'])).rows[0].status,'done');
  assert.equal((await pool.query('SELECT count(*)::int n FROM orders')).rows[0].n,1);
  const bad={...event,id:'bad',data:{...event.data,simulate_failure:true}}; const bb=JSON.stringify(bad); await send(sign(bb,'secret'),bb);
  await processOne(pool,{maxAttempts:2,baseDelayMs:10000}); let row=(await pool.query("SELECT status,attempts,next_attempt_at > now() AS delayed FROM events WHERE id='bad'")).rows[0]; assert.deepEqual(row,{status:'pending',attempts:1,delayed:true}); assert.equal(await processOne(pool),false);
  await pool.query("UPDATE events SET next_attempt_at=now() WHERE id='bad'"); await processOne(pool,{maxAttempts:2}); assert.equal((await pool.query('SELECT count(*)::int n FROM dead_letters')).rows[0].n,1);
  const {execFile}=await import('node:child_process'); const {promisify}=await import('node:util'); await promisify(execFile)(process.execPath,['src/replay.js','bad'],{env:process.env}); assert.equal((await pool.query("SELECT status FROM events WHERE id='bad'")).rows[0].status,'pending'); assert.equal((await pool.query('SELECT count(*)::int n FROM dead_letters')).rows[0].n,0);
  await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='webhook_test_rep') THEN CREATE ROLE webhook_test_rep NOLOGIN; END IF; END $$"); await pool.query('GRANT SELECT ON orders TO webhook_test_rep');
  const c=await pool.connect(); try {await c.query('BEGIN'); await c.query('SET LOCAL ROLE webhook_test_rep'); await c.query("SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true)"); assert.equal((await c.query('SELECT count(*)::int n FROM orders')).rows[0].n,1); await c.query("SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true)"); assert.equal((await c.query('SELECT count(*)::int n FROM orders')).rows[0].n,0); await c.query('ROLLBACK');} finally {c.release();}
  assert.equal((await pool.query('SELECT count(*)::int n FROM audit_log')).rows[0].n,1);
 } finally {await new Promise(r=>server.close(r));}
});
