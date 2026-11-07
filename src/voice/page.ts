import {VoiceClient} from './client.ts';
import {pcmWav} from './protocol.ts';
const start = document.querySelector<HTMLButtonElement>('#start')!, stop = document.querySelector<HTMLButtonElement>('#stop')!, state = document.querySelector('#state')!, text = document.querySelector('#transcript')!;
let stream: MediaStream | undefined, context: AudioContext | undefined, node: AudioWorkletNode | undefined, client: VoiceClient | undefined;
async function release(ready=true) {const audio=context;context=undefined;stream?.getTracks().forEach(t=>t.stop());stream=undefined;node?.disconnect();node=undefined;stop.disabled=true;if(ready)start.disabled=false;if(audio&&audio.state!=='closed')await audio.close();}
start.onclick = async () => {
 start.disabled = true; text.replaceChildren();
 try {
  const session = await (await fetch('/api/session')).json();
  stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true}});
  context = new AudioContext({sampleRate: 16000}); await context.resume();
  await context.audioWorklet.addModule('/voice-worklet.js');
  node = new AudioWorkletNode(context, 'voice-chunks');
  client = new VoiceClient(location.origin.replace(/^http/, 'ws') + '/api/voice', session.csrf, segments => {
   for (const s of segments) {const li = document.createElement('li'); li.textContent = `${(s.startMs / 1000).toFixed(1)}–${(s.endMs / 1000).toFixed(1)}s: ${s.text}`; text.append(li);}
  }, message => {state.textContent = message;}, () => {void release();});
  const rate = context.sampleRate;
  node.port.onmessage = e => {
   if (e.data.type === 'chunk') {try {client?.push(pcmWav(new Float32Array(e.data.samples), rate));} catch {void release();}}
   if (e.data.type === 'flushed') {client?.finish(); void release(false);}
  };
  context.createMediaStreamSource(stream).connect(node); node.connect(context.destination);
  client.connect(); stop.disabled = false; state.textContent = 'Connecting. Speak a short note.';
 } catch (e) {client?.cancel(); state.textContent = (e as Error).message; await release();}
};
stop.onclick = () => {stop.disabled = true; node?.port.postMessage({type: 'flush'}); state.textContent = 'Finishing the last chunk…';};
window.addEventListener('pagehide', () => {client?.cancel(); void release();});
