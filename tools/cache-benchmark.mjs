import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createService} from '../src/local/service.ts';
import {PostgresDatabase} from '../src/storage/postgres.ts';

const url=process.env.REDIS_URL??process.env.TEST_REDIS_URL;
if(!url)throw Error('Set REDIS_URL to a disposable Redis instance. See docs/redis-cache.md.');
const samples=Number(process.env.BENCH_READS??60);
if(!Number.isInteger(samples)||samples<10||samples>500)throw Error('BENCH_READS must be an integer from 10 to 500.');
let app,storage,admin,schema;
try{
 if(process.env.BENCH_DATABASE_URL){
  schema='cache_bench_'+randomUUID().replaceAll('-','');admin=new PostgresDatabase(process.env.BENCH_DATABASE_URL);
  await admin.exec('CREATE SCHEMA '+schema);
  storage=new PostgresDatabase({connectionString:process.env.BENCH_DATABASE_URL,options:'-c search_path='+schema});
 }
 app=await createService({database:':memory:',storage,demo:false,env:{REDIS_URL:url}});
 const rows=Array.from({length:500},(_,i)=>app.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('task',`bench-${String(i).padStart(4,'0')}`,JSON.stringify({title:`Fictional coursework ${i}`,status:'todo',userNotes:'Fictional planning notes. '.repeat(40)}),1,'2026-01-01','2026-01-01'));
 await app.db.batch(rows);
 const cache=app.env.RECORD_CACHE,latencies={database:[],redis:[]},payloadReads={database:0,redis:0},states={};let current;
 const prepare=app.db.prepare.bind(app.db);
 app.db.prepare=query=>{if(current&&/^SELECT \* FROM records WHERE kind=\?/.test(query))payloadReads[current]++;return prepare(query);};
 let expectedHash,bytes;
 async function read(mode,measure){
  app.env.RECORD_CACHE=mode==='redis'?cache:null;current=measure?mode:null;
  const start=performance.now(),response=await app.fetch(new Request(app.origin+'/api/records/task?limit=500'));
  const body=await response.text(),elapsed=performance.now()-start;
  assert.equal(response.status,200);const hash=createHash('sha256').update(body).digest('hex');
  expectedHash??=hash;assert.equal(hash,expectedHash,'Cached and database responses must be identical');bytes=Buffer.byteLength(body);
  if(mode==='redis'){const status=response.headers.get('x-lifeos-cache');assert.ok(['miss','hit'].includes(status),'Benchmark requires working Redis');if(measure)assert.equal(status,'hit');}
  if(measure){latencies[mode].push(elapsed);const status=response.headers.get('x-lifeos-cache')??'disabled';states[status]=(states[status]??0)+1;}
 }
 // Warm both paths before interleaving measured reads to reduce ordering/JIT bias.
 try{
  for(let i=0;i<10;i++){await read('database',false);await read('redis',false);}
  for(let i=0;i<samples;i++)for(const mode of i%2?['redis','database']:['database','redis'])await read(mode,true);
 }finally{app.env.RECORD_CACHE=cache;}
 const report={database:storage?'postgres':'sqlite',records:500,responseBytes:bytes,readsPerMode:samples,warmupPerMode:10,scope:'API handler and JSON body consumption; excludes HTTP transport',latencyMs:{},recordPayloadQueries:payloadReads,cacheStates:states};
 for(const [mode,values] of Object.entries(latencies)){
  values.sort((a,b)=>a-b);const quantile=p=>Number(values[Math.ceil(values.length*p)-1].toFixed(3));
  report.latencyMs[mode]={p50:quantile(.5),p95:quantile(.95)};
 }
 report.p50RatioDatabaseOverRedis=Number((report.latencyMs.database.p50/report.latencyMs.redis.p50).toFixed(2));
 console.log(JSON.stringify(report,null,2));
}finally{
 await app?.close();if(!app)await storage?.close();
 if(admin){try{if(schema)await admin.exec('DROP SCHEMA '+schema+' CASCADE');}finally{await admin.close();}}
}
