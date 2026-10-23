import test from 'node:test';import assert from 'node:assert/strict';import {createHostedRuntime} from './hosted-test-runtime.mjs';
test('real hosted app isolates visitors and denies private/integration capabilities',async()=>{
 const {mf,blocked,origin}=await createHostedRuntime({inspect:true});
 const get=async(path,cookie)=>mf.dispatchFetch(origin+path,{headers:cookie?{cookie}:{}});
 const session=async()=>{const root=await get('/');assert.equal(root.status,200,await root.clone().text());assert.match(await root.clone().text(),/demo-bootstrap\.js/,'Hosted browser isolation must load before app');const cookie=root.headers.get('set-cookie').split(';')[0];const s=await get('/api/session',cookie);assert.equal(s.status,200,await s.clone().text());return {cookie,...await s.json()};};
 const request=(s,path,method,body)=>mf.dispatchFetch(origin+path,{method,headers:{cookie:s.cookie,origin,'x-lifeos-csrf':s.csrf,'content-type':'application/json'},body:JSON.stringify(body)});
 try{
 const a=await session(),b=await session();assert.notEqual(a.cookie,b.cookie);assert.notEqual(a.csrf,b.csrf);
 let response=await get('/api/bootstrap',a.cookie);assert.equal(response.status,200,await response.clone().text());const boot=await response.json();assert.ok(boot.records.course.length);
 const note=await(await get('/api/private-notes',a.cookie)).json();const item=note.items?.find(x=>x.id==='demo-note')??note.notes?.find(x=>x.id==='demo-note');assert.ok(item,JSON.stringify(Object.keys(note)));
 const marker='VISITOR-A-ISOLATION-CANARY';response=await request(a,'/api/private-notes/demo-note','PUT',{version:item.version,mutationId:crypto.randomUUID(),data:{...item.data,title:marker}});assert.equal(response.status,200,await response.clone().text());
 assert.match(await(await get('/api/private-notes',a.cookie)).text(),new RegExp(marker));assert.ok(!(await(await get('/api/private-notes',b.cookie)).text()).includes(marker));
 for(const path of ['/api/worker/claim','/api/actions/cloud-sync','/api/actions/release','/api/presence','/api/jobs']){response=await request(a,path,'POST',{type:'maintenance',payload:{}});assert.equal(response.status,403,path);}
 response=await mf.dispatchFetch(origin+'/api/private-notes/demo-note',{method:'PUT',headers:{cookie:a.cookie,origin:'https://evil.example.test','x-lifeos-csrf':a.csrf,'content-type':'application/json'},body:'{}'});assert.equal(response.status,403);
 const mockJob=await request(a,'/api/jobs','POST',{mutationId:crypto.randomUUID(),type:'coop-draft',payload:{roleId:'demo-role'}});assert.equal(mockJob.status,200,'Fictional job must work without a real provider');
 const assistant=await request(a,'/api/assistant/threads','POST',{id:crypto.randomUUID(),scope:'academics',mutationId:crypto.randomUUID()});assert.equal(assistant.status,200,await assistant.clone().text());const thread=(await assistant.json()).item;
 response=await request(a,'/api/assistant/threads/'+thread.id+'/messages','POST',{message:'Explain feedback loops',sentAt:new Date().toISOString(),mutationId:crypto.randomUUID()});assert.equal(response.status,200,await response.clone().text());
 const answer=await(await get('/api/assistant/threads/'+thread.id,a.cookie)).json();assert.ok(answer.messages.some(m=>m.data.role==='assistant'&&m.data.mock));
 const fileOwnerId=JSON.parse(Buffer.from(a.cookie.split('=')[1].split('.')[0],'base64url')).id;
 const fileStore=await mf.unsafeGetDurableObjectStorage('demo-test','DemoWorkspace',{name:fileOwnerId});
 const fileCanary=Buffer.from('VISITOR-A-BINARY-CANARY');await fileStore.exec('UPDATE local_objects SET content=? WHERE id=?',fileCanary,'demo-audio-file');
 const aExport=await(await get('/api/export',a.cookie)).json();assert.equal(aExport.tables.local_objects.find(r=>r.id==='demo-audio-file').content.lifeosBlob,fileCanary.toString('base64'));
 response=await get('/api/export',b.cookie);assert.equal(response.status,200);const bExport=await response.text();assert.ok(!bExport.includes(marker));assert.ok(!bExport.includes(fileCanary.toString('base64')),'Visitor A binary leaked into visitor B export');
 const aid=JSON.parse(Buffer.from(a.cookie.split('=')[1].split('.')[0],'base64url')).id;const as=await mf.unsafeGetDurableObjectStorage('demo-test','DemoWorkspace',{name:aid});await as.exec("UPDATE _demo_state SET state=json_set(state,'$.minute',?,'$.count',58) WHERE id=1",Math.floor(Date.now()/60000));response=await request(a,'/api/demo/reset','POST',{});assert.equal(response.status,200);const nextSession=await(await get('/api/session',a.cookie)).json();assert.notEqual(nextSession.csrf,a.csrf,'Reset must rotate browser generation');assert.equal((await request(a,'/api/private-notes/demo-note','PUT',{})).status,429,'Reset must preserve rate limit');await as.exec("UPDATE _demo_state SET state=json_set(state,'$.count',0) WHERE id=1");assert.equal((await request(a,'/api/private-notes/demo-note','PUT',{})).status,403,'Stale tab must not replay writing');assert.ok(!(await(await get('/api/private-notes',a.cookie)).text()).includes(marker));
 const id=JSON.parse(Buffer.from(a.cookie.split('=')[1].split('.')[0],'base64url')).id;
 const store=await mf.unsafeGetDurableObjectStorage('demo-test','DemoWorkspace',{name:id});
 await store.exec("UPDATE _demo_state SET state=json_set(state,'$.expiresAt',0) WHERE id=1");
 response=await get('/api/demo/status',a.cookie);assert.equal(response.status,410);
 assert.deepEqual(await store.exec("SELECT name FROM sqlite_master WHERE name='records'"),[],'Expired visitor data retained');
 assert.equal((await get('/api/private-notes',b.cookie)).status,200,'Other visitor affected by expiry');
 response=await get('/',a.cookie);assert.equal(response.status,200,'Reload should create a fresh visitor after expiry');assert.notEqual(response.headers.get('set-cookie').split(';')[0],a.cookie);
 const bid=JSON.parse(Buffer.from(b.cookie.split('=')[1].split('.')[0],'base64url')).id;
 const bs=await mf.unsafeGetDurableObjectStorage('demo-test','DemoWorkspace',{name:bid});
 await bs.exec("UPDATE _demo_state SET state=json_set(state,'$.minute',?,'$.count',60) WHERE id=1",Math.floor(Date.now()/60000));
 assert.equal((await get('/api/demo/status',b.cookie)).status,429,'Per-visitor request limit missing');
 const admission=await mf.unsafeGetDurableObjectStorage('demo-test','DemoAdmission',{name:'daily'});
 await admission.exec('UPDATE admission SET requests=10000');assert.equal((await get('/api/demo/status',b.cookie)).status,429,'Global dynamic request limit missing');
 assert.equal(blocked.length,0,'Unexpected external network call: '+blocked.join(','));
 }finally{await mf.dispose();}
});
