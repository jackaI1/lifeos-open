import {randomBytes} from 'node:crypto';import {digest} from './store.mjs';import {loadPlan,commitPlan} from './records.mjs';import {AppError} from '../shared/errors.mjs';import * as v from '../server/validation.mjs';
export async function deviceRoute({store,path,req,body,config}){
 if(path==='/api/presence'){
  const raw=req.headers.get('authorization');if(req.method!=='POST'||!/^Bearer [A-Za-z0-9_-]{43}$/.test(raw??''))throw new AppError('Device authentication required',401);
  const device=await store.sql('SELECT id FROM presence_devices WHERE token_hash=? AND revoked=0',await digest(raw.slice(7))).first();if(!device)throw new AppError('Device authentication required',401);
  v.exactFields(body,['eventId','zone','type','occurredAt']);v.identifier(body.eventId);v.enumValue(body.zone,['home','campus']);v.enumValue(body.type,['arrival','departure']);
  const now=Date.now(),at=Date.parse(body.occurredAt);if(typeof body.occurredAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(body.occurredAt)||!Number.isFinite(at)||at>now+300000||at<now-7*86400000)throw new AppError('Use the actual event time with timezone, within the last seven days');
  const id=await digest(JSON.stringify([device.id,body.eventId])),mutationId='presence-'+device.id+'-'+body.eventId,fingerprint={deviceId:device.id,...body},prior=await store.mutation(mutationId,await digest(JSON.stringify(fingerprint)));if(prior)return Response.json(prior);
  const plan=await loadPlan(store,['presence']);plan.put('presence',id,{zone:body.zone,type:body.type,occurredAt:new Date(at).toISOString(),receivedAt:new Date(now).toISOString(),authenticated:true,source:'shortcut',confidence:'observed',deviceId:device.id},0,{actor:'authorized-presence-device'});
  return Response.json(await commitPlan(store,plan,{id:mutationId,fingerprint,result:{received:true,id,duplicateSafe:true},extra:[store.assertion('SELECT EXISTS(SELECT 1 FROM presence_devices WHERE id=? AND revoked=0)',[device.id])]}));
 }
 if(path==='/api/devices'&&req.method==='GET')return Response.json({devices:(await store.sql('SELECT id,label,created_at AS createdAt,revoked FROM presence_devices ORDER BY created_at DESC LIMIT 100').all()).results});
 if(req.method!=='POST'||!['/api/devices','/api/devices/revoke'].includes(path))return null;
 if(config.environment!=='production'&&!config.localMode)throw new AppError('Issue phone credentials on production',403);
 const mid=v.mutationId(body.mutationId),fingerprint={path,body},prior=await store.mutation(mid,await digest(JSON.stringify(fingerprint)));if(prior)return Response.json({...prior,token:null});
 const plan=await loadPlan(store,['connection-audit']);
 if(path.endsWith('/revoke')){v.exactFields(body,['id','mutationId']);v.identifier(body.id);if(!await store.sql('SELECT id FROM presence_devices WHERE id=?',body.id).first())throw new AppError('Device not found',404);plan.upsertInternal('connection-audit','revoke-'+body.id,{action:'presence-device-revoked',id:body.id},'owner');return Response.json(await commitPlan(store,plan,{id:mid,fingerprint,result:{revoked:true},extra:[store.sql('UPDATE presence_devices SET revoked=1 WHERE id=?',body.id)]}));}
 v.exactFields(body,['label','mutationId']);const label=v.text(body.label,100,{required:true}),id=crypto.randomUUID(),token=randomBytes(32).toString('base64url'),createdAt=new Date().toISOString();plan.put('connection-audit',id,{action:'presence-device-created',label,createdAt,scope:'named-zone-presence-only'},0);
 const result=await commitPlan(store,plan,{id:mid,fingerprint,result:{id,label,createdAt,tokenShownOnce:true,endpoint:'/api/presence',scope:'named-zone-presence-only'},extra:[store.sql('INSERT INTO presence_devices VALUES(?,?,?,?,0)',id,label,await digest(token),createdAt)]});return Response.json({...result,token:result.id===id?token:null});
}
