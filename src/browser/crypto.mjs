import {sha256} from '@noble/hashes/sha2.js';
import {md5} from '@noble/hashes/legacy.js';
import {Buffer} from 'buffer';
export const randomUUID=()=>globalThis.crypto.randomUUID();
export function randomBytes(size){const bytes=Buffer.alloc(size);for(let i=0;i<size;i+=65536)globalThis.crypto.getRandomValues(bytes.subarray(i,Math.min(size,i+65536)));return bytes;}
export function createHash(name){const algorithm=({sha256,md5})[String(name).toLowerCase()];if(!algorithm)throw Error('Unsupported browser hash');const hash=algorithm.create();return {update(value,encoding){hash.update(typeof value==='string'?Buffer.from(value,encoding):new Uint8Array(value));return this;},digest(encoding){const bytes=Buffer.from(hash.digest());return encoding?bytes.toString(encoding):bytes;}};}
