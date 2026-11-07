import {WebSocketServer, WebSocket} from 'ws';
import type {Server} from 'node:http';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pythonWhisper} from '../local/whisper.ts';
import {MAX_WAV, MAX_CHUNKS} from './protocol.ts';
import type {ClientMessage, ServerMessage, Segment} from './protocol.ts';
export type Recognize = (wav: Buffer, signal: AbortSignal) => Promise<Segment[]>;
export function whisperRecognizer(python: string, model = 'base.en'): Recognize {
 const infer = pythonWhisper(python, model);
 return async (wav, signal) => {
  const dir = await mkdtemp(join(tmpdir(), 'lifeos-live-'));
  try {
   await writeFile(join(dir, 'chunk.wav'), wav, {mode: 0o600});
   await writeFile(join(dir, 'input.json'), JSON.stringify([join(dir, 'chunk.wav')]), {mode: 0o600});
   await infer(join(dir, 'input.json'), join(dir, 'output.json'), signal);
   const [result] = JSON.parse(await readFile(join(dir, 'output.json'), 'utf8'));
   return result.segments.map((s: {start: number; end: number; text: string}) => ({startMs: Math.round(s.start * 1000), endMs: Math.round(s.end * 1000), text: s.text.trim()}));
  } finally {await rm(dir, {recursive: true, force: true});}
 };
}
function duration(wav: Buffer) {
 if (wav.length < 46 || wav.length > MAX_WAV || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 16) !== 'WAVEfmt ' || wav.readUInt32LE(16) !== 16 || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16 || wav.toString('ascii', 36, 40) !== 'data' || wav.readUInt32LE(40) !== wav.length - 44 || wav.readUInt32LE(4) !== wav.length - 8 || (wav.length - 44) % 2) throw Error('Expected a complete mono PCM16 WAV chunk.');
 const rate = wav.readUInt32LE(24), ms = (wav.length - 44) / 2 / rate * 1000;
 if (rate < 8000 || rate > 48000 || wav.readUInt32LE(28) !== rate * 2 || wav.readUInt16LE(32) !== 2 || !Number.isFinite(ms) || ms > 5000) throw Error('Chunk must contain at most five seconds of audio.');
 return ms;
}
type Session = {next: number; elapsed: number; textBytes:number; replies: Extract<ServerMessage, {type: 'partial'}>[]; touched: number; socket?: WebSocket; pending: boolean; ended: boolean};
/** Retained in memory for 2 minutes after disconnection; restart expires sessions explicitly. */
export function attachVoice(server: Server, {origin, csrf, authorize, recognize, workerBusy=()=>false, idleMs = 120000}: {origin: string; csrf: string; authorize: (headers: Record<string, string>) => Promise<boolean>; recognize: Recognize; workerBusy?:()=>boolean; idleMs?: number}) {
 const wss = new WebSocketServer({noServer: true, maxPayload: Math.ceil(MAX_WAV * 4 / 3) + 256, perMessageDeflate: false});
 const sessions = new Map<string, Session>(), active = new Set<Promise<void>>(), abort = new AbortController();
 let busy = false, closing = false;
 const sweep = () => {for (const [id, s] of sessions) if (!s.pending && s.socket?.readyState !== WebSocket.OPEN && Date.now() - s.touched > idleMs) sessions.delete(id);};
 const timer = setInterval(sweep, Math.min(idleMs, 30000)); timer.unref();
 const upgrade: Parameters<Server['on']>[1] = async (req: any, socket: any, head: any) => {
  if (closing || req.url !== '/api/voice' || req.headers.host !== new URL(origin).host || req.headers.origin !== origin) {socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;}
  try {
   if (!await authorize(req.headers)) {socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;}
   if (closing || socket.destroyed) {socket.destroy();return;}
   wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  } catch {socket.destroy();}
 };
 server.on('upgrade', upgrade);
 wss.on('connection', ws => {
  let session: Session | undefined;
  const send = (message: ServerMessage, target = ws) => {if (target.readyState === WebSocket.OPEN) target.send(JSON.stringify(message));};
  const error = (code: Extract<ServerMessage, {type: 'error'}>['code'], message: string, retryable = false) => send({type: 'error', code, message, next: session?.next ?? 0, retryable});
  const hello = setTimeout(() => ws.close(1008, 'Start required'), 5000); hello.unref();
  ws.on('error', () => {});
  ws.on('close', () => {clearTimeout(hello); if (session?.socket === ws) {session.socket = undefined; session.touched = Date.now();}});
  ws.on('message', raw => {
   let m: ClientMessage;
   try {m = JSON.parse(raw.toString());} catch {error('invalid', 'Invalid JSON.'); return;}
   if (m?.type === 'start') {
    if (session || m.version !== 1 || m.csrf !== csrf || !/^[a-f0-9]{64}$/.test(m.session) || !Number.isSafeInteger(m.after) || m.after < -1) {error('invalid', 'Invalid start.'); return;}
    sweep(); let s = sessions.get(m.session);
    if (!s && m.after !== -1) {error('expired', 'Session expired. Start a new recording.'); return;}
    if (!s) {if (sessions.size >= 16) {error('busy', 'Too many retained sessions.', true); return;} s = {next: 0, elapsed: 0, textBytes:0, replies: [], touched: Date.now(), pending: false, ended: false}; sessions.set(m.session, s);}
    if (m.after >= s.next) {error('sequence', 'Resume position exceeds completed audio.'); return;}
    clearTimeout(hello); session = s;
    if (s.socket && s.socket !== ws) s.socket.close(1000, 'Reconnected elsewhere');
    s.socket = ws; s.touched = Date.now();
    send({type: 'start', session: m.session, next: s.next, credit: busy || workerBusy() ? 0 : 1});
    for (const partial of s.replies) if (partial.seq > m.after) send({...partial, credit: busy || workerBusy() ? 0 : 1});
    if (s.ended) send({type: 'final', seq: s.next - 1, segments: s.replies.flatMap(p => p.segments)});
    return;
   }
   if (!session || session.socket !== ws || session.ended) {error('invalid', 'Start a session before sending audio.'); return;}
   const s = session; s.touched = Date.now();
   if (m?.type === 'final') {
    if (s.pending || m.seq !== s.next - 1) {error('sequence', 'Wait for every partial before final.'); return;}
    s.ended = true; send({type: 'final', seq: m.seq, segments: s.replies.flatMap(p => p.segments)}); ws.close(1000, 'Flushed'); return;
   }
   if (m?.type !== 'audio' || !Number.isSafeInteger(m.seq) || m.seq < 0 || typeof m.wav !== 'string' || m.wav.length > Math.ceil(MAX_WAV * 4 / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(m.wav)) {error('invalid', 'Invalid audio message.'); return;}
   if (m.seq < s.next) {send(s.replies[m.seq]); return;}
   if (m.seq !== s.next || s.next >= MAX_CHUNKS) {error('sequence', 'Unexpected sequence or recording limit reached.'); return;}
   if (busy || s.pending || workerBusy()) {error('busy', 'Worker busy; retain this chunk and retry.', true); return;}
   let wav: Buffer, ms: number;
   try {wav = Buffer.from(m.wav, 'base64'); ms = duration(wav);} catch (e) {error('invalid', (e as Error).message); return;}
   busy = true; s.pending = true;
   const task = (async () => {
    try {
     const segments = await recognize(wav, AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]));
     if (!Array.isArray(segments) || segments.length > 1000 || segments.some((p, i) => !Number.isFinite(p.startMs) || !Number.isFinite(p.endMs) || p.startMs < 0 || p.startMs >= ms || p.endMs <= p.startMs || typeof p.text !== 'string' || p.text.length > 10000 || (i > 0 && p.startMs < segments[i-1].startMs))) throw Error('Invalid recognition output.');
     const size=Buffer.byteLength(JSON.stringify(segments));if(size>32768||s.textBytes+size>2*1024*1024)throw Error('Transcript limit reached');s.textBytes+=size;
     const reply: Extract<ServerMessage, {type: 'partial'}> = {type: 'partial', seq: s.next, segments: segments.map(p => ({...p, startMs: Math.round(p.startMs + s.elapsed), endMs: Math.round(Math.min(ms, p.endMs) + s.elapsed)})), credit: 1};
     s.replies.push(reply); s.next++; s.elapsed += ms;
     if (s.socket) send(reply, s.socket);
    } catch {if (s.socket) send({type: 'error', code: 'inference', message: 'Local recognition failed. Retry or check Whisper setup.', next: s.next, retryable: false}, s.socket);}
    finally {busy = false; s.pending = false; s.touched = Date.now();}
   })();
   active.add(task); void task.finally(() => active.delete(task));
  });
 });
 return {async close() {closing = true; server.off('upgrade', upgrade); clearInterval(timer); abort.abort(); for (const ws of wss.clients) ws.terminate(); await Promise.all(active); await new Promise<void>(r => wss.close(() => r())); sessions.clear();}};
}
