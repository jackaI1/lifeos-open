import {randomBytes,randomUUID} from 'node:crypto';
import {AppError,hash} from './store.mjs';
import * as v from './validation.mjs';
function table(store){store.db.exec('CREATE TABLE IF NOT EXISTS presence_devices(id TEXT PRIMARY KEY,label TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0)');}
export function listDevices(store){table(store);return store.db.prepare('SELECT id,label,created_at AS createdAt,revoked FROM presence_devices ORDER BY created_at DESC').all();}
export function createDevice(store,input){table(store);v.exactFields(input,['label','mutationId']);const label=v.text(input.label,100,{required:true}),mutationId=v.mutationId(input.mutationId),token=randomBytes(32).toString('base64url');let issued=false;
 const result=store.mutate(mutationId,{action:'create-presence-device',label},()=>{const id=randomUUID(),createdAt=new Date().toISOString();store.db.prepare('INSERT INTO presence_devices VALUES(?,?,?,?,0)').run(id,label,hash(token),createdAt);store.put('connection-audit',id,{action:'presence-device-created',label,createdAt,scope:'named-zone-presence-only'},0);issued=true;return {id,label,createdAt};});
 return {...result,token:issued?token:null,tokenShownOnce:true,endpoint:'/api/presence',scope:'named-zone-presence-only'};
}
export function revokeDevice(store,input){table(store);v.exactFields(input,['id','mutationId']);v.identifier(input.id);return store.mutate(v.mutationId(input.mutationId),{action:'revoke-presence-device',id:input.id},()=>{const device=store.db.prepare('SELECT id FROM presence_devices WHERE id=?').get(input.id);if(!device)throw new AppError('Device not found',404);store.db.prepare('UPDATE presence_devices SET revoked=1 WHERE id=?').run(input.id);store.upsertInternal('connection-audit','revoke-'+input.id,{action:'presence-device-revoked',id:input.id},'owner');return {revoked:true};});}
export function receivePresence(store,req,input,now=Date.now()){
 table(store);const raw=req.headers.authorization;if(typeof raw!=='string'||!/^Bearer [A-Za-z0-9_-]{43}$/.test(raw))throw new AppError('Device authentication required',401);
 const device=store.db.prepare('SELECT id FROM presence_devices WHERE token_hash=? AND revoked=0').get(hash(raw.slice(7)));if(!device)throw new AppError('Device authentication required',401);
 v.exactFields(input,['eventId','zone','type','occurredAt']);v.identifier(input.eventId);v.enumValue(input.zone,['home','campus']);v.enumValue(input.type,['arrival','departure']);
 const at=Date.parse(input.occurredAt);if(typeof input.occurredAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(input.occurredAt)||!Number.isFinite(at)||at>now+300000||at<now-7*86400000)throw new AppError('Use the actual event time with timezone, within the last seven days');
 const fingerprint={deviceId:device.id,...input};return store.mutate('presence-'+device.id+'-'+input.eventId,fingerprint,()=>{const id=hash([device.id,input.eventId]);const item=store.put('presence',id,{zone:input.zone,type:input.type,occurredAt:new Date(at).toISOString(),receivedAt:new Date(now).toISOString(),authenticated:true,source:'shortcut',confidence:'observed',deviceId:device.id},0,{actor:'authorized-presence-device'});return {received:true,id:item.id,duplicateSafe:true};});
}
