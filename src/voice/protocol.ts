/** Version 1: mono signed PCM16 WAV, independently decodable chunks, one credit. */
export type Segment = {startMs: number; endMs: number; text: string};
export type ClientMessage =
 | {type: 'start'; version: 1; session: string; csrf: string; after: number}
 | {type: 'audio'; seq: number; wav: string}
 | {type: 'final'; seq: number};
export type ServerMessage =
 | {type: 'start'; session: string; next: number; credit: number}
 | {type: 'partial'; seq: number; segments: Segment[]; credit: number}
 | {type: 'final'; seq: number; segments: Segment[]}
 | {type: 'error'; code: 'invalid' | 'busy' | 'sequence' | 'expired' | 'inference'; message: string; next: number; retryable: boolean};
export const MAX_WAV = 48000 * 2 * 5 + 44;
export const MAX_CHUNKS = 1200; // One hour at three seconds/chunk; no unbounded session history.
export function pcmWav(samples: Float32Array, rate: number): Uint8Array {
 const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
 const ascii = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
 ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVEfmt ');
 view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
 view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
 ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
 samples.forEach((x, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x)) * 32767), true));
 return bytes;
}
