import {AppError} from '../shared/errors.mjs';
import {digest} from './store.mjs';
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const unb64=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export const token=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
export const cookies=req=>Object.fromEntries((req.headers.get('cookie')??'').split(';').map(s=>s.trim().split(/=(.*)/s)).filter(s=>s.length>1));
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let result=0;for(let i=0;i<a.length;i++)result|=a.charCodeAt(i)^b.charCodeAt(i);return result===0;}
const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
let keyCache=null;
export async function verifyIdentity(jwt,env,nonce,{fetcher=fetch,now=Date.now()}={}){
 if(typeof jwt!=='string'||jwt.length>16000)throw new AppError('Invalid Google identity',403,'account_denied');
 const parts=jwt.split('.');if(parts.length!==3)throw new AppError('Invalid Google identity',403);
 let header,payload;try{header=JSON.parse(new TextDecoder().decode(unb64(parts[0])));payload=JSON.parse(new TextDecoder().decode(unb64(parts[1])));}catch{throw new AppError('Invalid Google identity',403);}
 if(header.alg!=='RS256'||typeof header.kid!=='string')throw new AppError('Invalid identity signature',403);
 if(!keyCache||keyCache.expires<now||!keyCache.keys.some(k=>k.kid===header.kid)){
  const response=await fetcher('https://www.googleapis.com/oauth2/v3/certs',{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new AppError('Google identity verification is unavailable',503);
  const body=await response.json();if(!Array.isArray(body.keys)||body.keys.length>10)throw new AppError('Identity keys unavailable',503);
  keyCache={keys:body.keys,expires:now+300000};
 }
 const jwk=keyCache.keys.find(k=>k.kid===header.kid);if(!jwk)throw new AppError('Identity signature unavailable',403);
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,unb64(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw new AppError('Invalid Google signature',403);
 if(payload.email!==env.ALLOWED_EMAIL||payload.email_verified!==true||!['accounts.google.com','https://accounts.google.com'].includes(payload.iss)||payload.aud!==env.GOOGLE_CLIENT_ID||!Number.isFinite(payload.exp)||payload.exp*1000<=now||!Number.isFinite(payload.iat)||payload.iat*1000>now+300000||typeof payload.sub!=='string'||!payload.sub||payload.nonce!==nonce)throw new AppError('This account is not authorized',403,'account_denied');
 return payload;
}
export class CloudAuth {
 constructor(store,env){this.store=store;this.env=env;}
 async session(req){if(this.env.AUTH_MODE==='demo')return {email:this.env.ALLOWED_EMAIL,csrf:this.env.LOCAL_CSRF};if(this.env.AUTH_MODE==='local')return cookies(req)['lifeos-local']===this.env.LOCAL_SESSION_TOKEN?{email:this.env.ALLOWED_EMAIL,csrf:this.env.LOCAL_CSRF}:null;const raw=cookies(req)['__Host-lifeos'];if(!raw||raw.length>128)return null;const row=await this.store.sql('SELECT * FROM sessions WHERE token_hash=? AND revoked=0 AND expires_at>?',await digest(raw),Date.now()).first();return row?.email===this.env.ALLOWED_EMAIL?row:null;}
 csrf(req,session){if(req.headers.get('origin')!==this.env.APP_ORIGIN||!equal(req.headers.get('x-lifeos-csrf'),session.csrf))throw new AppError('Request origin or session verification failed',403,'csrf');}
 async login(){
  if(this.env.AUTH_MODE==='demo')return new Response(null,{status:303,headers:{Location:'/'}});
  if(this.env.AUTH_MODE==='local')return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><title>LifeOS local sign in</title><main><h1>Local workspace</h1><form action="/auth/local" method="post"><label>Access token <input type="password" name="token" required autocomplete="current-password"></label><button>Sign in</button></form></main></html>',{headers:{'content-type':'text/html; charset=utf-8'}});
  const state=token(),nonce=token(),verifier=token();
  await this.store.sql('INSERT INTO oauth_logins VALUES(?,?,?,?)',await digest(state),nonce,verifier,Date.now()+600000).run();
  const challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  const params=new URLSearchParams({client_id:this.env.GOOGLE_CLIENT_ID,redirect_uri:this.env.APP_ORIGIN+'/auth/google',response_type:'code',scope:'openid email',state,nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'});
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to LifeOS</title><style>body{background:#071523;color:#e8f0f6;font:17px system-ui;margin:0;min-height:100svh;display:grid;place-items:center}main{padding:2rem;max-width:24rem}a{display:inline-block;background:#cbdfef;color:#11253a;padding:1rem;border-radius:.8rem;text-decoration:none}</style><main><h1>LifeOS</h1><p>Sign in to your private workspace.</p><a href="https://accounts.google.com/o/oauth2/v2/auth?${params.toString().replaceAll('&','&amp;')}">Sign in with Google</a></main></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Set-Cookie':cookie('__Host-lifeos-login',state,600)}});
 }
 async callback(req){
  const params=new URL(req.url).searchParams,state=params.get('state');if(!state||state.length>128||!equal(state,cookies(req)['__Host-lifeos-login'])||params.has('error'))throw new AppError('Google sign-in verification failed. Please retry.',403,'google_auth');
  const code=params.get('code');if(!code||code.length>4096)throw new AppError('Incomplete Google sign-in',403);
  const flow=await this.store.sql('DELETE FROM oauth_logins WHERE state_hash=? AND expires_at>? RETURNING *',await digest(state),Date.now()).first();if(!flow)throw new AppError('Sign-in expired. Please retry.',403);
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({code,client_id:this.env.GOOGLE_CLIENT_ID,client_secret:this.env.GOOGLE_CLIENT_SECRET,redirect_uri:this.env.APP_ORIGIN+'/auth/google',grant_type:'authorization_code',code_verifier:flow.verifier}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new AppError('Google sign-in could not finish. Please retry.',403);
  const tokens=await response.json();await verifyIdentity(tokens.id_token,this.env,flow.nonce);
  const raw=token(),csrf=token(),now=Date.now();await this.store.sql('INSERT INTO sessions VALUES(?,?,?,?,?,0)',await digest(raw),this.env.ALLOWED_EMAIL,csrf,now,now+30*86400000).run();
  const headers=new Headers({Location:'/'});headers.append('Set-Cookie',cookie('__Host-lifeos',raw,2592000));headers.append('Set-Cookie',cookie('__Host-lifeos-login','',0));return new Response(null,{status:303,headers});
 }
 async logout(req){if(this.env.AUTH_MODE==='demo'||this.env.AUTH_MODE==='local')return new Response(null,{status:204,headers:{'Set-Cookie':'lifeos-local=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'}});const raw=cookies(req)['__Host-lifeos'];if(raw)await this.store.sql('UPDATE sessions SET revoked=1 WHERE token_hash=?',await digest(raw)).run();return new Response(null,{status:204,headers:{'Set-Cookie':cookie('__Host-lifeos','',0)}});}
}
