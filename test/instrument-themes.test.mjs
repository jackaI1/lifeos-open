import test from 'node:test';
import assert from 'node:assert/strict';
import {recordData} from '../src/server/validation.mjs';
import {createService} from '../src/local/service.ts';
const ids=['graphite','midnight','desk','aluminium','handheld','field','cassette','calculator','platinum','nightdrive'];
for(const theme of ids)test('settings accepts Instrument theme '+theme,()=>assert.equal(recordData('settings',{theme}).theme,theme));
test('settings rejects invalid theme values',()=>{for(const theme of ['unknown','Graphite','',null,5,{},'__proto__'])assert.throws(()=>recordData('settings',{theme}));});
test('theme saves preserve unrelated settings and enforce revisions',async()=>{
 const app=await createService({database:':memory:'});
 try{
  const session=await(await app.fetch(new Request(app.origin+'/api/session'))).json();
  const read=async()=> (await(await app.fetch(new Request(app.origin+'/api/records/settings/preferences'))).json()).item;
  const save=async(record,theme)=>app.fetch(new Request(app.origin+'/api/records/settings/preferences',{method:'PUT',headers:{origin:app.origin,'x-lifeos-csrf':session.csrf,'content-type':'application/json'},body:JSON.stringify({mutationId:crypto.randomUUID(),version:record.version,data:{...record.data,theme}})}));
  let record=await read();const wake=record.data.wakeTime;
  for(const theme of ids){const response=await save(record,theme);assert.equal(response.status,200);const updated=await read();assert.equal(updated.data.theme,theme);assert.equal(updated.data.wakeTime,wake);assert.ok(updated.version>record.version);record=updated;}
  const stale={...record,version:record.version-1};assert.equal((await save(stale,'desk')).status,409);assert.equal((await read()).data.theme,'nightdrive');
 }finally{app.close();}
});
test('versioned app assets serve every bundled font with its font MIME type',async()=>{
 const app=await createService({database:':memory:'});
 try{for(const file of ['Barlow-Regular','Barlow-Medium','Barlow-SemiBold','BarlowSemiCondensed-Medium','BarlowSemiCondensed-SemiBold']){
  const response=await app.fetch(new Request(app.origin+'/__assets/0000000000000000000000000000000000000001/fonts/'+file+'.woff2'));
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'font/woff2');assert.ok((await response.arrayBuffer()).byteLength>30000);
 }}finally{app.close();}
});
