import { z } from 'zod';

export const MAX_MESSAGE_BYTES = 64 * 1024;
export const roomSchema = z.string().regex(/^[a-zA-Z0-9_-]{6,64}$/);
const candidateSchema = z.object({
  candidate: z.string().max(8192),
  sdpMid: z.string().max(256).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
}).strict();
const clientSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('join'), room: roomSchema}).strict(),
  z.object({type: z.literal('offer'), sdp: z.string().min(1).max(60000)}).strict(),
  z.object({type: z.literal('answer'), sdp: z.string().min(1).max(60000)}).strict(),
  z.object({type: z.literal('ice'), candidate: candidateSchema.nullable()}).strict(),
]);
export type ClientMessage = z.infer<typeof clientSchema>;
export type SignalMessage = Exclude<ClientMessage, {type: 'join'}>;
export type ServerMessage = SignalMessage |
  {type: 'joined' | 'peer-ready'; initiator: boolean} |
  {type: 'peer-left'} | {type: 'error'; code: string};
export function parseClientMessage(raw: string): ClientMessage {
  if (new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES) throw new Error('Message too large');
  return clientSchema.parse(JSON.parse(raw));
}
