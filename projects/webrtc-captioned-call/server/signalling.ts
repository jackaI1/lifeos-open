import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { MAX_MESSAGE_BYTES, parseClientMessage, type ServerMessage } from '../src/protocol';

type Peer = { room?: string; tokens: number; updated: number; alive: boolean };
type Options = { burst?: number; maxRooms?: number };
export function createSignallingServer(http: Server, { burst = 120, maxRooms = 1000 }: Options = {}) {
  const rooms = new Map<string, Set<WebSocket>>();
  const peers = new Map<WebSocket, Peer>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
  const upgrade: Parameters<Server['on']>[1] = (request: any, socket: any, head: any) => {
    // Browser clients must come from this host. Non-browser clients have no Origin.
    let allowed = !request.headers.origin;
    try { allowed ||= new URL(request.headers.origin).host === request.headers.host; } catch { /* invalid origin */ }
    if (request.url !== '/signal' || !allowed || peers.size >= maxRooms * 2) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  };
  http.on('upgrade', upgrade);
  function send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > MAX_MESSAGE_BYTES * 4) { ws.close(1013, 'Slow client'); return; }
      ws.send(JSON.stringify(message));
    }
  }
  function leave(ws: WebSocket) {
    const peer = peers.get(ws);
    peers.delete(ws);
    if (!peer?.room) return;
    const room = rooms.get(peer.room);
    room?.delete(ws);
    if (!room?.size) rooms.delete(peer.room);
    else for (const other of room) send(other, {type:'peer-left'});
  }
  wss.on('connection', ws => {
    const peer: Peer = { tokens: burst, updated: Date.now(), alive: true };
    peers.set(ws, peer);
    ws.on('pong', () => { peer.alive = true; });
    ws.on('error', () => { /* close event owns cleanup */ });
    ws.on('close', () => leave(ws));
    ws.on('message', (raw, binary) => {
      const now = Date.now();
      peer.tokens = Math.min(burst, peer.tokens + (now - peer.updated) * (burst / 60_000));
      peer.updated = now;
      if (peer.tokens < 1) { send(ws, {type:'error',code:'rate-limit'}); ws.close(1008, 'Rate limit'); return; }
      peer.tokens--;
      let message;
      try { if (binary) throw new Error('Binary input'); message = parseClientMessage(raw.toString()); }
      catch { send(ws, {type:'error',code:'invalid-message'}); return; }
      if (message.type === 'join') {
        if (peer.room) { send(ws, {type:'error',code:'already-joined'}); return; }
        const room = rooms.get(message.room) ?? new Set<WebSocket>();
        if (room.size >= 2) { send(ws, {type:'error',code:'room-full'}); return; }
        if (!room.size && rooms.size >= maxRooms) { send(ws, {type:'error',code:'server-full'}); return; }
        room.add(ws); rooms.set(message.room, room); peer.room = message.room;
        send(ws, {type:'joined',initiator:room.size === 1});
        if (room.size === 2) {
          for (const [i, other] of [...room].entries()) send(other, {type:'peer-ready',initiator:i === 0});
        }
      } else {
        if (!peer.room) { send(ws, {type:'error',code:'not-joined'}); return; }
        for (const other of rooms.get(peer.room) ?? []) if (other !== ws) send(other, message);
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const [ws, peer] of peers) {
      if (!peer.alive) ws.terminate(); else { peer.alive = false; ws.ping(); }
    }
  }, 30_000);
  heartbeat.unref();
  return {
    async close() {
      clearInterval(heartbeat); http.off('upgrade', upgrade);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      rooms.clear(); peers.clear();
    },
  };
}
