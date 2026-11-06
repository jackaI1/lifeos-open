import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,connect} from 'node:net';
import {createClient} from 'redis';
import {createService} from './helpers/service.mjs';
import {RecordCache} from '../src/local/record-cache.ts';

const redisUrl=process.env.TEST_REDIS_URL;
async function fixture(t,env={}){
 const app=await createService({database:':memory:',demo:false,env});
 t.after(()=>app.close());
 let recordReads=0;const prepare=app.db.prepare.bind(app.db);
 app.db.prepare=query=>{if(/^SELECT \* FROM records WHERE kind=\?/.test(query))recordReads++;return prepare(query);};
 const request=async(path,options)=>app.fetch(new Request(app.origin+path,options));
 const get=(path='/api/records/task')=>request(path);
 const put=async(id,title,version=0)=>{
  const session=await (await get('/api/session')).json();
  return request('/api/records/task/'+id,{method:'PUT',headers:{'content-type':'application/json',origin:app.origin,'x-lifeos-csrf':session.csrf},body:JSON.stringify({version,data:{title,status:'todo'},mutationId:crypto.randomUUID()})});
 };
 return {app,get,put,reads:()=>recordReads};
}
async function insert(app,id,title='Fictional task'){
 await app.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').bind('task',id,JSON.stringify({title,status:'todo'}),1,'2026-01-01','2026-01-01').run();
}
// Real TCP fixture can drop or stall Redis without touching anybody else's server.
async function proxy(t,url){
 const target=new URL(url),sockets=new Set();let mode='forward';
 const server=createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
  if(mode==='down'){socket.destroy();return;}
  if(mode==='stall')return;
  const upstream=connect(Number(target.port||6379),target.hostname);sockets.add(upstream);
  upstream.on('close',()=>sockets.delete(upstream));
  socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
  socket.pipe(upstream).pipe(socket);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 console.log(`Owned Redis test proxy pid=${process.pid} start=${new Date(Date.now()-process.uptime()*1000).toISOString()} port=${port}; cleanup=server.close + socket.destroy in test teardown`);
 t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));assert.equal(server.listening,false);});
 return {url:`redis://127.0.0.1:${port}`,setMode(value){mode=value;for(const socket of sockets){if(value==='pause')socket.unpipe();else socket.destroy();}}};
}

test('Redis is optional: ordinary reads work without it',async t=>{
 const f=await fixture(t);await insert(f.app,'off');
 const r=await f.get();assert.equal(r.status,200);assert.equal((await r.json()).items[0].data.title,'Fictional task');
});
test('unreachable Redis falls back to the database within a bounded wait',async t=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const f=await fixture(t,{REDIS_URL:`redis://127.0.0.1:${port}`});await insert(f.app,'down');
 const started=performance.now(),r=await f.get();assert.equal(r.status,200);
 assert.equal(r.headers.get('x-lifeos-cache'),'bypass');assert.equal((await r.json()).items[0].id,'down');assert.ok(performance.now()-started<1500);
});

test('real Redis record cache', {skip:!redisUrl},async t=>{
 await t.test('miss fills Redis; hit skips record payload SQL for lists and details',async t=>{
  const f=await fixture(t,{REDIS_URL:redisUrl});await insert(f.app,'hit');
  for(const path of ['/api/records/task','/api/records/task/hit']){
   const before=f.reads(),a=await f.get(path);assert.equal(a.headers.get('x-lifeos-cache'),'miss');const body=await a.json();assert.equal(f.reads(),before+1);
   const b=await f.get(path);assert.equal(b.headers.get('x-lifeos-cache'),'hit');assert.deepEqual(await b.json(),body);assert.equal(f.reads(),before+1);
  }
 });
 await t.test('API edits and inserts invalidate all pages and detail keys',async t=>{
  const f=await fixture(t,{REDIS_URL:redisUrl});await insert(f.app,'edit','Before');
  await (await f.get()).json();await (await f.get('/api/records/task/edit')).json();
  assert.equal((await f.put('edit','After',1)).status,200);
  const r=await f.get('/api/records/task/edit');assert.equal(r.headers.get('x-lifeos-cache'),'miss');assert.equal((await r.json()).item.data.title,'After');
  const list=await f.get();assert.equal(list.headers.get('x-lifeos-cache'),'miss');assert.equal((await list.json()).items[0].version,2);
  assert.equal((await f.put('new','New')).status,200);assert.equal((await (await f.get()).json()).items.length,2);
 });
 await t.test('raw worker writes, deletes and recreate at version one invalidate cached reads',async t=>{
  const f=await fixture(t,{REDIS_URL:redisUrl});await insert(f.app,'worker','Original');await f.get();await f.get('/api/records/task/worker');
  await f.app.db.prepare('UPDATE records SET data=?,version=version+1 WHERE kind=? AND id=?').bind('{"title":"Worker changed"}','task','worker').run();
  assert.equal((await (await f.get()).json()).items[0].data.title,'Worker changed');
  await f.app.db.prepare('DELETE FROM records WHERE kind=? AND id=?').bind('task','worker').run();
  assert.deepEqual((await (await f.get()).json()).items,[]);assert.equal((await f.get('/api/records/task/worker')).status,404);
  await insert(f.app,'worker','Recreated');assert.equal((await (await f.get('/api/records/task/worker')).json()).item.data.title,'Recreated');
 });
 await t.test('failed database transactions leave warm entries valid',async t=>{
  const f=await fixture(t,{REDIS_URL:redisUrl});await insert(f.app,'rollback');await f.get();
  await assert.rejects(()=>f.app.db.batch([f.app.db.prepare("UPDATE records SET data='{}' WHERE kind='task'"),f.app.db.prepare('INSERT INTO assertions VALUES(?,0)').bind('fail')]));
  const r=await f.get();assert.equal(r.headers.get('x-lifeos-cache'),'hit');assert.equal((await r.json()).items[0].data.title,'Fictional task');
 });
 await t.test('page keys and separate workspaces never share values',async t=>{
  const f=await fixture(t,{REDIS_URL:redisUrl}),other=await fixture(t,{REDIS_URL:redisUrl});
  await insert(f.app,'a','A');await insert(f.app,'b','B');await insert(other.app,'a','Other');
  for(const [path,title] of [['/api/records/task?limit=1','A'],['/api/records/task?offset=1&limit=1','B']]){
   assert.equal((await (await f.get(path)).json()).items[0].data.title,title);assert.equal((await f.get(path)).headers.get('x-lifeos-cache'),'hit');
  }
  assert.equal((await (await other.get('/api/records/task?limit=1')).json()).items[0].data.title,'Other');
 });
 await t.test('a warm cache never bypasses authentication or origin checks',async t=>{
  const f=await fixture(t,{REDIS_URL:redisUrl});await insert(f.app,'auth');await f.get();
  f.app.env.AUTH_MODE='local';
  assert.equal((await f.get()).status,401);
  assert.equal((await f.app.fetch(new Request('http://localhost:8787/api/records/task'))).status,403);
 });
 await t.test('Redis connection loss and writes during outage recover with current values',async t=>{
  const p=await proxy(t,redisUrl),f=await fixture(t,{REDIS_URL:p.url});await insert(f.app,'outage','Before');await f.get();assert.equal((await f.get()).headers.get('x-lifeos-cache'),'hit');
  p.setMode('down');assert.equal((await f.put('outage','During outage',1)).status,200);
  const down=await f.get();assert.equal(down.status,200);assert.equal(down.headers.get('x-lifeos-cache'),'bypass');assert.equal((await down.json()).items[0].data.title,'During outage');
  p.setMode('forward');await new Promise(r=>setTimeout(r,1100));
  const recovered=await f.get();assert.equal(recovered.headers.get('x-lifeos-cache'),'miss');assert.equal((await recovered.json()).items[0].data.title,'During outage');assert.equal((await f.get()).headers.get('x-lifeos-cache'),'hit');
 });
 await t.test('a Redis socket that accepts but never replies cannot hang reads',async t=>{
  const p=await proxy(t,redisUrl);p.setMode('stall');const f=await fixture(t,{REDIS_URL:p.url});await insert(f.app,'stall');
  const started=performance.now(),r=await f.get();assert.equal(r.status,200);assert.equal(r.headers.get('x-lifeos-cache'),'bypass');assert.ok(performance.now()-started<1500);
 });
 await t.test('a warm Redis command that stalls is bounded too',async t=>{
  const p=await proxy(t,redisUrl),f=await fixture(t,{REDIS_URL:p.url});await insert(f.app,'stall-command');await f.get();p.setMode('pause');
  const started=performance.now(),r=await f.get();assert.equal(r.status,200);assert.equal(r.headers.get('x-lifeos-cache'),'bypass');assert.ok(performance.now()-started<1500);
 });
 await t.test('a revision change during a fill never saves the old result under a new revision',async t=>{
  const cache=new RecordCache(redisUrl);t.after(()=>cache.close());let version=1;
  const old={items:[{id:'race',data:{title:'Old'}}]},fresh={items:[{id:'race',data:{title:'New'}}]};
  const first=await cache.read({kind:'task',revision:async()=>version,load:async()=>{version=2;return old;}});
  assert.equal(first.status,'bypass');
  const next=await cache.read({kind:'task',revision:async()=>version,load:async()=>fresh});assert.equal(next.status,'miss');assert.deepEqual(next.body,fresh);
 });
 await t.test('a revision change during a hit reloads current data',async t=>{
  const cache=new RecordCache(redisUrl);t.after(()=>cache.close());
  await cache.read({kind:'task',revision:async()=>1,load:async()=>({items:[{id:'race',data:{title:'Old'}}]})});
  let checks=0;const r=await cache.read({kind:'task',revision:async()=>++checks===1?1:2,load:async()=>({items:[{id:'race',data:{title:'New'}}]})});
  assert.equal(r.status,'bypass');assert.equal(r.body.items[0].data.title,'New');
 });
 await t.test('a failed freshness check never serves cached data or hides a database failure',async t=>{
  const cache=new RecordCache(redisUrl);t.after(()=>cache.close());
  await cache.read({kind:'task',revision:async()=>1,load:async()=>({items:[]})});
  let checks=0;
  await assert.rejects(()=>cache.read({kind:'task',revision:async()=>{if(++checks===2)throw Error('Database unavailable');return 1;},load:async()=>({items:[]})}),/Database unavailable/);
 });
 await t.test('oversized responses are returned without storing a cache entry',async t=>{
  const cache=new RecordCache(redisUrl);t.after(()=>cache.close());let loads=0;
  for(let i=0;i<2;i++){
   const r=await cache.read({kind:'task',revision:async()=>1,load:async()=>{loads++;return {items:[{data:{title:'x'.repeat(2*1024*1024)}}]};}});
   assert.equal(r.status,'bypass');assert.equal(r.body.items.length,1);
  }
  assert.equal(loads,2);
 });
 await t.test('malformed cached JSON is replaced from the database',async t=>{
  const f=await fixture(t,{REDIS_URL:redisUrl});await insert(f.app,'corrupt');await f.get();
  const admin=createClient({url:redisUrl,socket:{connectTimeout:500,reconnectStrategy:false}});admin.on('error',()=>{});await admin.connect();t.after(()=>admin.destroy());
  const keys=await admin.keys(`lifeos:records:v1:${f.app.env.RECORD_CACHE.namespace}:*`);assert.equal(keys.length,1);assert.ok(await admin.ttl(keys[0])>0);await admin.set(keys[0],'not json');
  const r=await f.get();assert.equal(r.status,200);assert.equal((await r.json()).items[0].id,'corrupt');assert.equal((await f.get()).headers.get('x-lifeos-cache'),'hit');
 });
});
