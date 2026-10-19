import {AppError} from '../shared/errors.mjs';
const cache=new Map();
export async function googleToken(env){
 const key=env.ENVIRONMENT,old=cache.get(key);if(old&&old.expires>Date.now()+60000)return old.token;
 if(!env.GOOGLE_REFRESH_TOKEN)throw new AppError('Google needs sign-in',503,'auth_required');
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new AppError('Google needs sign-in or is temporarily unavailable',503,response.status===400?'auth_required':'google_unavailable');
 const value=await response.json();if(typeof value.access_token!=='string')throw new AppError('Google authorization unavailable',503);
 cache.set(key,{token:value.access_token,expires:Date.now()+Math.min(Number(value.expires_in)||300,3600)*1000});return value.access_token;
}
export async function googleFetch(env,url,options={}){
 if(env.LOCAL_OBJECTS)return env.LOCAL_OBJECTS.fetch(url,options);
 const target=new URL(url);if(target.protocol!=='https:'||!['www.googleapis.com','docs.googleapis.com'].includes(target.hostname))throw new AppError('Provider destination denied',403);
 const headers=new Headers(options.headers);headers.set('Authorization','Bearer '+await googleToken(env));
 const response=await fetch(url,{...options,headers,redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(!response.ok&&response.status!==308)throw new AppError('Google operation failed; saved data is retained',503,response.status===401?'auth_required':response.status===404?'google_not_found':'google_unavailable');return response;
}
export const driveFields='id,name,mimeType,parents,owners(emailAddress),shared,trashed,size,md5Checksum,appProperties';
export async function privateFile(env,id,folder){
 if(!/^[\w-]{1,200}$/.test(id))throw new AppError('File identifier denied',403);
 const item=await (await googleFetch(env,`https://www.googleapis.com/drive/v3/files/${id}?fields=${encodeURIComponent(driveFields)}`)).json();
 if(item.trashed||item.shared||!item.owners?.some(o=>o.emailAddress===env.ALLOWED_EMAIL)||!item.parents?.includes(folder))throw new AppError('Private file ownership or destination changed',403,'file_denied');return item;
}
