import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {WebSocket} from 'ws';
import {attachVoice} from '../src/voice/server.ts';
import {pcmWav} from '../src/voice/protocol.ts';
const id = 'a'.repeat(64), csrf = 'test-csrf';
export async function fixture(t, recognize, options={}) {
 const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;
 const voice = attachVoice(server, {origin, csrf, authorize: async()=>true, recognize, ...options});
 const clients=[];
 t.after(async()=>{for (const ws of clients) ws.terminate(); await voice.close(); await new Promise(r=>server.close(r)); assert.equal(server.listening,false);});
 async function connect(after=-1, session=id) {
  const ws = new WebSocket(origin.replace('http','ws')+'/api/voice',{origin}); clients.push(ws);
  const queue=[],waiters=[];
  ws.on('message',raw=>{const m=JSON.parse(raw); const w=waiters.shift(); if(w)w(m);else queue.push(m);});
  const next=()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('socket response timeout')),5000);waiters.push(m=>{clearTimeout(timer);resolve(m);});});
  await once(ws,'open');
  const send=m=>ws.send(JSON.stringify(m));send({type:'start',version:1,csrf,session,after});
  return {ws,send,next,origin};
 }
 return {connect,origin};
}
const segment = [{startMs:0,endMs:100,text:'recorded speech'}];
const audio=async()=>{const full=await readFile('test/fixtures/whisper/jfk.wav');const pcm=new Int16Array(full.buffer,full.byteOffset+44,16000);return Buffer.from(pcmWav(Float32Array.from(pcm,x=>x/32768),16000)).toString('base64');};
test('real socket orders recorded chunks, replays a lost partial and flushes final',async t=>{
 let calls=0;const f=await fixture(t,async bytes=>{assert.equal(bytes.toString('ascii',8,12),'WAVE');calls++;return segment;});
 const wav=await audio();const a=await f.connect();assert.equal((await a.next()).type,'start');
 a.send({type:'audio',seq:0,wav});assert.equal((await a.next()).seq,0);
 a.ws.close();await once(a.ws,'close');
 const b=await f.connect(-1);assert.equal((await b.next()).next,1);assert.equal((await b.next()).seq,0);
 b.send({type:'audio',seq:0,wav});assert.equal((await b.next()).seq,0);assert.equal(calls,1,'duplicate not recognized twice');
 b.send({type:'audio',seq:1,wav});const partial=await b.next();assert.equal(partial.seq,1);assert.equal(partial.segments[0].startMs,1000);
 b.send({type:'final',seq:1});const final=await b.next();assert.equal(final.type,'final');assert.equal(final.segments.length,2);await once(b.ws,'close');assert.equal(calls,2);
});
test('busy worker rejects excess chunks without advancing sequence, resumes in-flight result',async t=>{
 let release;const f=await fixture(t,()=>new Promise(r=>{release=()=>r(segment);}));
 const a=await f.connect();await a.next();const wav=await audio();a.send({type:'audio',seq:0,wav});a.send({type:'audio',seq:0,wav});
 assert.equal((await a.next()).code,'busy');a.send({type:'final',seq:-1});assert.equal((await a.next()).code,'sequence');
 a.ws.close();await once(a.ws,'close');const b=await f.connect();assert.equal((await b.next()).credit,0);release();assert.equal((await b.next()).seq,0);
});
test('invalid messages, gaps, expired resume and failed inference are explicit',async t=>{
 const f=await fixture(t,async()=>{throw Error('sensitive worker failure');});
 const a=await f.connect();await a.next();a.ws.send('{');assert.equal((await a.next()).code,'invalid');
 a.send({type:'audio',seq:2,wav:await audio()});assert.equal((await a.next()).code,'sequence');
 a.send({type:'audio',seq:0,wav:'YQ=='});assert.equal((await a.next()).code,'invalid');
 a.send({type:'audio',seq:0,wav:await audio()});const failure=await a.next();assert.equal(failure.code,'inference');assert.equal(failure.next,0);assert.ok(!failure.message.includes('sensitive'));
 const b=await f.connect(0,'b'.repeat(64));assert.equal((await b.next()).code,'expired');
});
test('cross-origin upgrade is rejected before recognition',async t=>{
 const f=await fixture(t,async()=>segment);
 const ws=new WebSocket(f.origin.replace('http','ws')+'/api/voice',{origin:'https://evil.invalid'});
 const [error]=await once(ws,'error');assert.match(error.message,/403/);ws.terminate();
});
test('saved and live recognition share one inference slot, with cancellable waiting',async()=>{
 const {withWhisperSlot,whisperIsBusy}=await import('../src/local/whisper.ts');const abort=new AbortController();let release,started;
 const running=new Promise(r=>{started=r;}),first=withWhisperSlot(new AbortController().signal,async()=>{started();await new Promise(r=>{release=r;});});await running;assert.ok(whisperIsBusy());
 let called=false;const waiting=withWhisperSlot(abort.signal,async()=>{called=true;});abort.abort();await assert.rejects(waiting);assert.equal(called,false);release();await first;assert.equal(whisperIsBusy(),false);
});
test('saved recording inference applies back-pressure before accepting a live chunk',async t=>{
 const f=await fixture(t,async()=>{throw Error('must not run');},{workerBusy:()=>true}),a=await f.connect();assert.equal((await a.next()).credit,0);a.send({type:'audio',seq:0,wav:await audio()});const response=await a.next();assert.equal(response.code,'busy');assert.equal(response.next,0);
});
