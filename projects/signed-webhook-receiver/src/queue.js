export async function processOne(pool, {maxAttempts=5, baseDelayMs=1000, handler=handleEvent}={}) {
 const c=await pool.connect(); let event;
 try {
  await c.query('BEGIN');
  const result=await c.query(`SELECT * FROM events WHERE (status='pending' AND next_attempt_at <= now()) OR (status='processing' AND locked_at < now() - interval '5 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
  if (!result.rowCount) {await c.query('COMMIT'); return false;}
  event=result.rows[0];
  await c.query("UPDATE events SET status='processing', locked_at=now(), attempts=attempts+1 WHERE id=$1",[event.id]);
  await c.query('COMMIT');
 } catch(e) {await c.query('ROLLBACK'); throw e;} finally {c.release();}
 // Side effects and completion are committed together, so a worker crash cannot create a partial order.
 const tx=await pool.connect();
 try {
  await tx.query('BEGIN');
  await handler(tx,event);
  await tx.query("UPDATE events SET status='done',locked_at=NULL,last_error=NULL WHERE id=$1",[event.id]);
  await tx.query('COMMIT');
 } catch(e) {
  await tx.query('ROLLBACK');
  const attempts=event.attempts+1, dead=attempts>=maxAttempts;
  await tx.query('BEGIN');
  try {
   await tx.query("UPDATE events SET status=$2,locked_at=NULL,last_error=$3,next_attempt_at=now()+($4 * interval '1 millisecond') WHERE id=$1",[event.id,dead?'dead':'pending',String(e.message).slice(0,1000),baseDelayMs*2**(attempts-1)]);
   if(dead) await tx.query('INSERT INTO dead_letters(event_id,payload,error) VALUES($1,$2,$3) ON CONFLICT(event_id) DO UPDATE SET error=excluded.error,failed_at=now()',[event.id,event.payload,String(e.message).slice(0,1000)]);
   await tx.query('COMMIT');
  } catch(err) {await tx.query('ROLLBACK'); throw err;}
 } finally {tx.release();}
 return true;
}
export async function handleEvent(db,event) {
 if(event.type !== 'order.created') throw new Error(`unsupported event type: ${event.type}`);
 const d=event.payload.data;
 if(d.simulate_failure) throw new Error('simulated processing failure');
 if(typeof d.order_id !== 'string' || !d.order_id || typeof d.rep_id !== 'string' || !Number.isInteger(d.amount_cents) || d.amount_cents<0) throw new Error('invalid order');
 await db.query('INSERT INTO orders(id,rep_id,amount_cents) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[d.order_id,d.rep_id,d.amount_cents]);
}
