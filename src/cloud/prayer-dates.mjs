import * as v from '../server/validation.mjs';
import {AppError} from '../shared/errors.mjs';
import {digest} from './store.mjs';

// Owner-only journal metadata. Never rewrite a processing input or original audio clock.
export async function prayerDatesRoute({store,req,path,body}){
 if(path!=='/api/prayer-dates')return null;
 if(req.method==='GET')return Response.json({items:await store.list('prayer-date-correction',{limit:1000})});
 if(req.method!=='POST')throw new AppError('Method not allowed',405);
 v.exactFields(body,['mutationId','sessionId','version','day']);v.identifier(body.sessionId);v.version(body.version);v.date(body.day);
 const id=v.mutationId(body.mutationId),fingerprint={path,body},prior=await store.mutation(id,await digest(JSON.stringify(fingerprint)));if(prior)return Response.json(prior);
 const session=await store.sql("SELECT version FROM records WHERE kind='prayer-session' AND id=?",body.sessionId).first();if(!session)throw new AppError('This prayer is unavailable. Restore it from Deleted before changing its date.',404);
 const before=await store.get('prayer-date-correction',body.sessionId);if((before?.version??0)!==body.version)throw new AppError('The journal date changed on another device. Reopen this entry and try again.',409);
 const now=new Date().toISOString(),after={kind:'prayer-date-correction',id:body.sessionId,version:body.version+1,createdAt:before?.createdAt??now,updatedAt:now,data:{sessionId:body.sessionId,day:body.day,authority:'owner-corrected-journal-day'}};
 return Response.json(await store.commit({id,fingerprint,reads:[{kind:'prayer-session',id:body.sessionId,version:session.version}],changes:[{kind:after.kind,id:after.id,before,after,auditId:crypto.randomUUID(),actor:'owner-prayer-date'}],result:{item:after}}));
}
