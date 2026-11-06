import { Pool } from 'pg';
import type { Filters } from './filters';
const globalPool = globalThis as typeof globalThis & { tracePool?: Pool };
export const pool = globalPool.tracePool ?? new Pool({connectionString:process.env.DATABASE_URL});
if(process.env.NODE_ENV !== 'production') globalPool.tracePool = pool;
export type Run = {id:number; name:string; browser:string; status:string; started_at:Date; duration_ms:number; step_count:number; failed_steps:number};
export type Step = {id:number; position:number; name:string; status:string; duration_ms:number; screenshot_url:string|null; error:string|null};
export const PAGE_SIZE=10;
export async function listRuns(f:Filters) {
 const values: (string|number)[] = [`%${f.q.replace(/[\\%_]/g,'\\$&')}%`, f.status];
 const where = `WHERE (r.name ILIKE $1 OR r.browser ILIKE $1) AND ($2 = 'all' OR r.status = $2)`;
 const order = f.sort==='duration'?'r.duration_ms DESC, r.id DESC':f.sort==='oldest'?'r.started_at ASC, r.id ASC':'r.started_at DESC, r.id DESC';
 const count = await pool.query(`SELECT count(*)::int AS total FROM runs r ${where}`, values);
 const rows = await pool.query<Run>(`SELECT r.*, (SELECT count(*)::int FROM steps s WHERE s.run_id=r.id) AS step_count, (SELECT count(*)::int FROM steps s WHERE s.run_id=r.id AND s.status='failed') AS failed_steps FROM runs r ${where} ORDER BY ${order} LIMIT $3 OFFSET $4`, [...values,PAGE_SIZE,(f.page-1)*PAGE_SIZE]);
 return {runs:rows.rows,total:count.rows[0].total as number};
}
export async function getRun(id:number) {
 if(!Number.isSafeInteger(id)||id<1) return null;
 const run=await pool.query<Run>('SELECT * FROM runs WHERE id=$1',[id]);
 if(!run.rows[0]) return null;
 const steps=await pool.query<Step>('SELECT id, position, name, status, duration_ms, screenshot_url, error FROM steps WHERE run_id=$1 ORDER BY position',[id]);
 return {run:run.rows[0],steps:steps.rows};
}
