import test from'node:test';import assert from'node:assert/strict';import{createServer}from'node:http';import{attachVoice}from'../src/voice/server.ts';import{VoiceClient}from'../src/voice/client.ts';import{pcmWav}from'../src/voice/protocol.ts';
test('browser client drains retained chunks after reconnect and sends a clean final',{timeout:10000},async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 // Node WebSocket cannot set Origin; this fixture only supplies it on the owned server.
 server.prependListener('upgrade',req=>{req.headers.origin=origin;});
 let calls=0;const voice=attachVoice(server,{origin,csrf:'ci',authorize:async()=>true,recognize:async()=>{calls++;return[{startMs:0,endMs:100,text:'test'}];}}),partials=[];
 let done;const completed=new Promise(r=>{done=r;});const client=new VoiceClient(origin.replace('http','ws')+'/api/voice','ci',s=>{partials.push(...s);if(partials.length===1)client.socket.close();},()=>{},done);
 try{client.connect();client.push(pcmWav(new Float32Array(16000),16000));client.push(pcmWav(new Float32Array(8000),16000));client.finish();await completed;assert.equal(calls,2);assert.equal(partials.length,2);assert.equal(partials[1].startMs,1000);}finally{client.cancel();await voice.close();await new Promise(r=>server.close(r));}
});
