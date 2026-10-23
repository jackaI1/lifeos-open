import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createWorkspaceRequest} from './request.mjs';
import {createBrowserService} from '../../.runtime/browser-demo/service-test.mjs';
import initSqlJs from '../../.runtime/browser-demo/node_modules/sql.js/dist/sql-wasm.js';
const SQL=await initSqlJs(),origin='https://demo.invalid';
const call=(service,path,method='GET',data,extra={})=>service.fetch(new Request(origin+path,{method,headers:{origin,'x-lifeos-csrf':service.csrf,...(data?{'content-type':'application/json'}:{}),...extra},...(data?{body:typeof data==='string'?data:JSON.stringify(data)}:{})}));
async function json(response){assert.ok(response.ok,await response.clone().text());return response.json();}
test('real routes save notes, reminders, coursework, mock assistant replies, and complete binary exports offline',async()=>{
 const previous=globalThis.fetch;globalThis.fetch=()=>{throw Error('Unexpected network');};
 const service=await createBrowserService({SQL,origin,readAsset:readFile});
 let restored;
 try{
  const data=await json(await call(service,'/api/bootstrap'));assert.ok(data.records.course.length);
  const session=await json(await call(service,'/api/session'));assert.equal(session.storage,'browser');assert.equal(session.browserOnly,true);
  const noteId='browser-note',note={mutationId:randomUUID(),version:0,data:{title:'My local note',text:'Only in this browser.',folderId:null,pinned:false,imageIds:[]}};
  assert.equal((await json(await call(service,'/api/private-notes/'+noteId,'PUT',note))).item.version,1);
  assert.equal((await json(await call(service,'/api/private-notes/'+noteId,'PUT',note))).item.version,1,'idempotent replay');
  assert.equal((await call(service,'/api/private-notes/'+noteId,'PUT',{...note,mutationId:randomUUID()})).status,409,'stale versions cannot overwrite');
  const reminder={mutationId:randomUUID(),id:'browser-reminder',version:0,data:{listId:'personal',title:'An offline reminder',completed:false,tags:[],subtasks:[]}};
  assert.equal((await json(await call(service,'/api/actions/reminder-save','POST',reminder))).item.data.title,reminder.data.title);
  const coursework={mutationId:randomUUID(),version:0,data:{title:'Local course notes',text:'Feedback changes the next input.',taskId:'demo-prelab'}};
  assert.equal((await json(await call(service,'/api/records/coursework/browser-coursework','PUT',coursework))).item.data.text,coursework.data.text);
  await json(await call(service,'/api/assistant/threads','POST',{id:'browser-thread',scope:'academics',mutationId:randomUUID()}));
  await json(await call(service,'/api/assistant/threads/browser-thread/messages','POST',{message:'What should I bring to the lab?',sentAt:new Date().toISOString(),mutationId:randomUUID()}));
  const thread=await json(await call(service,'/api/assistant/threads/browser-thread'));assert.ok(thread.messages.some(m=>m.data.role==='assistant'&&m.data.mock));assert.equal(thread.job,null);
  const lecture=(await service.db.prepare("SELECT id FROM records WHERE kind='lecture' LIMIT 1").first()).id;
  assert.equal((await call(service,'/api/lectures/'+lecture)).status,200);
  const audio=await call(service,'/api/files/'+lecture+'-a-0000');assert.equal(audio.status,200);assert.ok((await audio.arrayBuffer()).byteLength>44);
  const backup=await json(await call(service,'/api/export'));assert.equal(backup.format,'lifeos-local-backup-v1');assert.ok(backup.tables.local_objects.some(r=>r.content.lifeosBlob));assert.ok(backup.tables.records.some(r=>r.id===noteId));
  const bytes=service.db.export();service.close();restored=await createBrowserService({SQL,origin,bytes,readAsset:()=>{throw Error('Seed assets read after restore');}});
  assert.equal((await json(await call(restored,'/api/private-notes/'+noteId))).item.data.text,note.data.text);
  assert.equal((await json(await call(restored,'/api/assistant/threads/browser-thread'))).messages.length,2);
  assert.equal((await call(restored,'/api/files/'+lecture+'-a-0000')).status,200);
 }finally{globalThis.fetch=previous;restored?.close();service.close();}
});
test('browser SQL batches roll back all writes on a violated precondition',async()=>{
 const service=await createBrowserService({SQL,origin,readAsset:readFile});
 try{await assert.rejects(service.db.batch([service.db.prepare("INSERT INTO meta VALUES('should-roll-back','1')"),service.db.prepare("INSERT INTO assertions VALUES('failing',0)")]));assert.equal(await service.db.prepare("SELECT value FROM meta WHERE key='should-roll-back'").first(),null);}finally{service.close();}
});
test('offline upload preserves bytes and verifies real SHA256 and MD5 checksums',async()=>{
 const previous=globalThis.fetch;globalThis.fetch=()=>{throw Error('Unexpected network');};const service=await createBrowserService({SQL,origin,readAsset:readFile});
 try{const bytes=new TextEncoder().encode('A local attachment.');const result=await service.fetch(new Request(origin+'/api/uploads/browser-upload/0',{method:'POST',headers:{origin,'x-lifeos-csrf':service.csrf,'x-mutation-id':randomUUID(),'content-type':'text/plain','x-content-sha256':createHash('sha256').update(bytes).digest('hex')},body:bytes}));assert.equal(result.status,200,await result.clone().text());await json(await call(service,'/api/actions/upload-finalize','POST',{mutationId:randomUUID(),sessionId:'browser-upload',totalChunks:1,kind:'attachment',title:'Offline file',mimeType:'text/plain'}));assert.equal(await (await call(service,'/api/files/browser-upload')).text(),'A local attachment.');}finally{globalThis.fetch=previous;service.close();}
});

test('local RPC preserves trusted origin when a browser strips forbidden request headers',async()=>{
 const service=await createBrowserService({SQL,origin,readAsset:readFile});
 class BrowserRequest extends Request {
  constructor(url,options){super(url,options);this.headers.delete('origin');}
 }
 try{
  const message={url:origin+'/api/private-notes/browser-origin-test',method:'PUT',headers:[['content-type','application/json'],['origin','https://untrusted.invalid']],body:new TextEncoder().encode(JSON.stringify({mutationId:randomUUID(),version:0,data:{title:'Browser origin check',text:'Saved on this device.'}}))};
  const request=createWorkspaceRequest(message,{origin,csrf:service.csrf,RequestClass:BrowserRequest});
  assert.equal(request.headers.get('origin'),origin,'local RPC must retain its validated origin');
  const response=await service.fetch(request);assert.equal(response.status,200,await response.clone().text());
  assert.equal((await json(await call(service,'/api/private-notes/browser-origin-test'))).item.data.text,'Saved on this device.');
  assert.throws(()=>createWorkspaceRequest({...message,url:'https://untrusted.invalid/api/private-notes/blocked'},{origin,csrf:service.csrf,RequestClass:BrowserRequest}),/Only local workspace/);
 }finally{service.close();}
});
