import type {ClientMessage, ServerMessage, Segment} from './protocol.ts';
/** Retain unacknowledged WAVs across sockets; only advance on a completed partial. */
export class VoiceClient {
 private socket?: WebSocket;
 private session = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
 private queue = new Map<number, string>();
 private next = 0;
 private after = -1;
 private inflight = false;
 private ready = false;
 private ending = false;
 private stopped = false;
 private timer?: ReturnType<typeof setTimeout>;
 private retries = 0;
 private url:string; private csrf:string; private partial:(segments:Segment[])=>void; private status:(s:string)=>void; private finished:()=>void;
 constructor(url: string, csrf: string, partial: (segments: Segment[]) => void, status: (s: string) => void, finished: () => void) {this.url=url;this.csrf=csrf;this.partial=partial;this.status=status;this.finished=finished;}
 connect() {
  if (this.stopped) return;
  this.socket = new WebSocket(this.url);
  this.socket.onopen = () => this.send({type: 'start', version: 1, session: this.session, csrf: this.csrf, after: this.after});
  this.socket.onmessage = e => {
   const m: ServerMessage = JSON.parse(e.data);
   if (m.type === 'start') {this.ready = true; this.inflight = false; this.retries = 0; this.status('Connected. Audio stays on this computer.'); this.schedule();}
   if (m.type === 'partial') {
    if (m.seq > this.after) {this.after = m.seq; this.partial(m.segments);}
    for (const seq of this.queue.keys()) if (seq <= this.after) this.queue.delete(seq);
    this.inflight = false; this.schedule();
   }
   if (m.type === 'error') {
    if (m.retryable) {this.inflight = false; this.status('Worker busy. Keeping audio until it is ready.'); this.schedule(500);}
    else this.fail(m.message);
   }
   if (m.type === 'final') {this.stopped = true; clearTimeout(this.timer); this.socket?.close(); this.status('Finished. Last audio chunk flushed.'); this.finished();}
  };
  this.socket.onclose = () => {
   this.ready = false; this.inflight = false;
   if (!this.stopped) {if (++this.retries > 12) {this.fail('Connection unavailable. Stop and try again.'); return;} this.status('Reconnecting. Keeping unacknowledged audio.'); clearTimeout(this.timer); this.timer = setTimeout(() => this.connect(), Math.min(5000, 250 * 2 ** this.retries));}
  };
  this.socket.onerror = () => this.socket?.close();
 }
 push(wav: Uint8Array) {
  if (this.ending || this.stopped) throw Error('Recording is closed.');
  // At most 30 seconds retained; do not silently discard a slow worker's audio.
  if (this.queue.size >= 10) {this.fail('Recognition cannot keep up. Stop and use the saved-recording transcript.'); throw Error('Audio buffer full.');}
  let binary = ''; for (const byte of wav) binary += String.fromCharCode(byte);
  this.queue.set(this.next++, btoa(binary)); this.pump();
 }
 finish() {this.ending = true; this.pump();}
 cancel() {this.stopped = true; clearTimeout(this.timer); this.queue.clear(); this.socket?.close();}
 private fail(message: string) {this.cancel(); this.status(message); this.finished();}
 private send(m: ClientMessage) {if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(m));}
 private schedule(delay = 0) {clearTimeout(this.timer); this.timer = setTimeout(() => this.pump(), delay);}
 private pump() {
  if (!this.ready || this.stopped || this.inflight) return;
  const chunk = this.queue.entries().next().value;
  if (chunk) {this.inflight = true; this.send({type: 'audio', seq: chunk[0], wav: chunk[1]});}
  else if (this.ending) {this.inflight = true; this.send({type: 'final', seq: this.after});}
 }
}
