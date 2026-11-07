// Audio never leaves this worklet as an incomplete WebM fragment.
class VoiceChunks extends AudioWorkletProcessor {
 constructor() {
  super(); this.parts = []; this.length = 0; this.done = false;
  this.port.onmessage = e => {if (e.data.type === 'flush') {this.flush(); this.done = true; this.port.postMessage({type:'flushed'});}};
 }
 flush() {
  if (!this.length) return;
  const samples = new Float32Array(this.length); let offset = 0;
  for (const part of this.parts) {samples.set(part, offset); offset += part.length;}
  this.port.postMessage({type:'chunk', samples:samples.buffer}, [samples.buffer]); this.parts = []; this.length = 0;
 }
 process(inputs) {
  if (this.done) return false;
  const data = inputs[0]?.[0];
  if (data?.length) {this.parts.push(data.slice()); this.length += data.length; if (this.length >= sampleRate * 3) this.flush();}
  return true;
 }
}
registerProcessor('voice-chunks', VoiceChunks);
