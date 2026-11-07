import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {WebSocket} from 'ws';
import {once} from 'node:events';
import {attachVoice,whisperRecognizer} from '../src/voice/server.ts';
import {pcmWav} from '../src/voice/protocol.ts';
test('recorded speech crosses the real socket and offline Whisper, with reconnect and tail flush',{timeout:180000},async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`,sockets=[],transcripts=[];
 const voice=attachVoice(server,{origin,csrf:'ci',authorize:async()=>true,recognize:whisperRecognizer(process.env.WHISPER_PYTHON??'python3','tiny.en')});
 try {
  const file=await readFile('test/fixtures/whisper/jfk.wav'),pcm=new Int16Array(file.buffer,file.byteOffset+44,(file.length-44)/2);
  let seq=0,ws;
  const connect=async(after)=>{
   ws=new WebSocket(origin.replace('http','ws')+'/api/voice',{origin});sockets.push(ws);await once(ws,'open');
   const ready=once(ws,'message');ws.send(JSON.stringify({type:'start',version:1,session:'f'.repeat(64),csrf:'ci',after}));assert.equal(JSON.parse((await ready)[0]).type,'start');
  };
  await connect(-1);
  for(let offset=0;offset<pcm.length;offset+=16000*4){
   const samples=Float32Array.from(pcm.subarray(offset,offset+16000*4),x=>x/32768),reply=once(ws,'message');
   ws.send(JSON.stringify({type:'audio',seq,wav:Buffer.from(pcmWav(samples,16000)).toString('base64')}));
   const partial=JSON.parse((await reply)[0]);assert.equal(partial.type,'partial',JSON.stringify(partial));assert.equal(partial.seq,seq);transcripts.push(...partial.segments);
   if(seq===0){ws.close();await once(ws,'close');await connect(seq);}
   seq++;
  }
  const done=once(ws,'message');ws.send(JSON.stringify({type:'final',seq:seq-1}));const final=JSON.parse((await done)[0]);assert.equal(final.type,'final');assert.deepEqual(final.segments,transcripts);
  assert.match(transcripts.map(s=>s.text).join(' ').toLowerCase(),/country/);assert.ok(transcripts.length>=3);for(let i=1;i<transcripts.length;i++)assert.ok(transcripts[i].startMs>=transcripts[i-1].startMs);
  console.log(`${seq} real PCM chunks recognized in order, including reconnect and final tail.`);
 } finally {for(const ws of sockets)ws.terminate();await voice.close();await new Promise(r=>server.close(r));}
});
