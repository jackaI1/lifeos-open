import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createSignallingServer } from '../server/signalling';
import { parseClientMessage } from '../src/protocol';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture(options = {}) {
  const http = createServer();
  const signalling = createSignallingServer(http, options);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as { port: number }).port;
  cleanups.push(async () => { await signalling.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  return async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/signal`);
    const messages: Record<string, any>[] = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>(resolve => socket.once('open', resolve));
    return {
      socket, messages,
      send: (data: unknown) => socket.send(JSON.stringify(data)),
      next: async (type: string | string[]) => {
        const matches = (m: Record<string, any>) => Array.isArray(type) ? type.includes(m.type) : m.type === type;
        await expect.poll(() => messages.some(matches), { timeout: 2000 }).toBe(true);
        return messages.splice(messages.findIndex(matches), 1)[0];
      },
    };
  };
}
describe('signalling validation', () => {
  it.each(['no json', '{}', '{"type":"join","room":"x"}', '{"type":"offer","sdp":""}', '{"type":"ice","candidate":{"candidate":1}}'])('rejects invalid payload %s', raw => {
    expect(() => parseClientMessage(raw)).toThrow();
  });
  it('accepts bounded ICE and end-of-candidates', () => {
    expect(parseClientMessage('{"type":"ice","candidate":null}')).toEqual({type: 'ice', candidate: null});
    expect(parseClientMessage('{"type":"ice","candidate":{"candidate":"candidate:test","sdpMid":"0","sdpMLineIndex":0}}').type).toBe('ice');
  });
  it('rejects unknown fields and oversized messages', () => {
    expect(() => parseClientMessage(JSON.stringify({type: 'join', room: 'abcdef', token: 'extra'}))).toThrow();
    expect(() => parseClientMessage(JSON.stringify({type: 'offer', sdp: 'a'.repeat(70_000)}))).toThrow();
  });
});
describe('WebSocket rooms', () => {
  it('assigns one caller and relays offers, answers and ICE only to the other peer', async () => {
    const connect = await fixture();
    const a = await connect(), b = await connect(), c = await connect();
    a.send({type:'join',room:'alpha123'}); c.send({type:'join',room:'other123'});
    expect((await a.next('joined')).initiator).toBe(true);
    await c.next('joined');
    b.send({type:'join',room:'alpha123'});
    expect((await b.next('joined')).initiator).toBe(false);
    expect((await a.next('peer-ready')).initiator).toBe(true);
    expect((await b.next('peer-ready')).initiator).toBe(false);
    a.send({type:'offer',sdp:'offer-sdp'});
    expect((await b.next('offer')).sdp).toBe('offer-sdp');
    b.send({type:'answer',sdp:'answer-sdp'});
    expect((await a.next('answer')).sdp).toBe('answer-sdp');
    a.send({type:'ice',candidate:{candidate:'candidate:test',sdpMid:'0'}});
    expect((await b.next('ice')).candidate.candidate).toBe('candidate:test');
    b.send({type:'ice',candidate:null});
    expect((await a.next('ice')).candidate).toBeNull();
    expect(c.messages).toEqual([]); expect(a.messages).toEqual([]);
  });
  it('rejects full rooms, repeated joins and signals before joining', async () => {
    const connect = await fixture(); const a = await connect(), b = await connect(), c = await connect();
    c.send({type:'offer',sdp:'early'}); expect((await c.next('error')).code).toBe('not-joined');
    a.send({type:'join',room:'alpha123'}); await a.next('joined');
    a.send({type:'join',room:'other123'}); expect((await a.next('error')).code).toBe('already-joined');
    b.send({type:'join',room:'alpha123'}); await b.next('joined');
    c.send({type:'join',room:'alpha123'}); expect((await c.next('error')).code).toBe('room-full');
  });
  it('notifies on disconnect and lets a replacement join', async () => {
    const connect = await fixture(); const a = await connect(), b = await connect();
    a.send({type:'join',room:'alpha123'}); await a.next('joined');
    b.send({type:'join',room:'alpha123'}); await b.next('joined'); await a.next('peer-ready');
    b.socket.close(); await a.next('peer-left');
    const replacement = await connect(); replacement.send({type:'join',room:'alpha123'});
    expect((await replacement.next('joined')).initiator).toBe(false);
    await a.next('peer-ready');
  });
  it('keeps running after malformed input and limits message bursts', async () => {
    const connect = await fixture({ burst: 3 }); const a = await connect();
    a.socket.send('bad'); expect((await a.next('error')).code).toBe('invalid-message');
    a.send({type:'join',room:'alpha123'}); await a.next('joined');
    a.send({type:'ice',candidate:null}); a.send({type:'ice',candidate:null});
    expect((await a.next('error')).code).toBe('rate-limit');
  });
  it('rejects binary messages and closes oversized frames', async () => {
    const connect = await fixture(); const a = await connect();
    a.socket.send(Buffer.from('binary'));
    expect((await a.next('error')).code).toBe('invalid-message');
    const closed = new Promise<number>(resolve => a.socket.once('close', code => resolve(code)));
    a.socket.send('x'.repeat(70_000));
    expect(await closed).toBe(1009);
  });
  it('bounds active rooms', async () => {
    const connect = await fixture({ maxRooms: 1 }); const a = await connect(), b = await connect();
    a.send({type:'join',room:'alpha123'}); await a.next('joined');
    b.send({type:'join',room:'other123'}); expect((await b.next('error')).code).toBe('server-full');
    const closed = new Promise<void>(resolve => a.socket.once('close', () => resolve()));
    a.socket.close(); await closed;
    // A client-side close can precede the server's close event. Retry until it has reclaimed the room.
    await expect.poll(async () => {
      b.send({type:'join',room:'other123'}); return (await b.next(['joined','error'])).type;
    }).toBe('joined');
  });
});
