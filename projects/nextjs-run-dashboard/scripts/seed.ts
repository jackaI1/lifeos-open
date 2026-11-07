import { Client } from 'pg';
async function main(){
 const client=new Client({connectionString:process.env.DATABASE_URL}); await client.connect();
 try { await client.query('BEGIN'); await client.query(`CREATE TABLE IF NOT EXISTS runs (id serial PRIMARY KEY, name text NOT NULL, browser text NOT NULL, status text NOT NULL CHECK (status IN ('passed','failed')), started_at timestamptz NOT NULL, duration_ms integer NOT NULL CHECK (duration_ms>=0)); CREATE TABLE IF NOT EXISTS steps (id serial PRIMARY KEY, run_id integer NOT NULL REFERENCES runs(id) ON DELETE CASCADE, position integer NOT NULL, name text NOT NULL, status text NOT NULL CHECK (status IN ('passed','failed')), duration_ms integer NOT NULL CHECK (duration_ms>=0), screenshot_url text, error text, UNIQUE(run_id, position));`);
 await client.query('TRUNCATE steps, runs RESTART IDENTITY');
 const names=['Checkout flow','Sign in','Search products','Update profile','Add to cart']; const browsers=['Chromium','Firefox','WebKit']; const steps=['Open page','Enter details','Submit form','Check result'];
 for(let i=0;i<36;i++){const failed=i%4===0; const durations=steps.map((_,j)=>300+((i*137+j*283)%1700)); const run=await client.query('INSERT INTO runs(name,browser,status,started_at,duration_ms) VALUES($1,$2,$3,$4,$5) RETURNING id',[names[i%names.length],browsers[i%3],failed?'failed':'passed',new Date(Date.UTC(2025,9,20,12)-i*3600000),durations.reduce((a,b)=>a+b,0)]);
 for(let j=0;j<steps.length;j++){const failure=failed&&j===2; await client.query('INSERT INTO steps(run_id,position,name,status,duration_ms,screenshot_url,error) VALUES($1,$2,$3,$4,$5,$6,$7)',[run.rows[0].id,j+1,steps[j],failure?'failed':'passed',durations[j],j===3||failure?'/screenshots/sample.svg':null,failure?'The expected confirmation did not appear before the timeout.':null]);}}
 await client.query('COMMIT'); console.log('Seeded 36 synthetic runs and 144 steps.');
 } catch(e){await client.query('ROLLBACK');throw e;} finally {await client.end();}
} main().catch(e=>{console.error(e);process.exitCode=1});
