import {OAuth2Client} from 'google-auth-library';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {hash,AppError} from './store.mjs';
export const token=()=>randomBytes(32).toString('base64url');
export function equal(a,b){return typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export function cookies(req){return Object.fromEntries((req.headers.cookie??'').split(';').map(p=>p.trim().split(/=(.*)/s)).filter(p=>p.length>1).map(([k,v])=>[k,v]));}
export function identityAllowed(p,config,nonce){return !!p&&p.email===config.allowedEmail&&p.email_verified===true&&['accounts.google.com','https://accounts.google.com'].includes(p.iss)&&p.aud===config.googleClientId&&Number.isFinite(p.exp)&&p.exp>Math.floor(Date.now()/1000)&&typeof p.sub==='string'&&p.sub.length>0&&p.nonce===nonce;}
export function createAuth(store,config,{verifyIdToken,exchangeCode}={}){
 const client=new OAuth2Client(config.googleClientId,config.googleClientSecret,config.origin+'/auth/google');const name='__Host-lifeos';
 store.db.exec('CREATE TABLE IF NOT EXISTS oauth_logins(state_hash TEXT PRIMARY KEY, nonce TEXT NOT NULL, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL)');
 const verify=verifyIdToken??(async value=>(await client.verifyIdToken({idToken:value,audience:config.googleClientId})).getPayload());
 function session(req){const value=cookies(req)[name];if(!value||value.length>128)return null;const row=store.db.prepare('SELECT * FROM sessions WHERE token_hash=? AND revoked=0 AND expires_at>?').get(hash(value),Date.now());return row?.email===config.allowedEmail?row:null;}
 function issue(email){const raw=token(),csrf=token(),now=Date.now();store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,0)').run(hash(raw),email,csrf,now,now+30*86400000);return {cookie:`${name}=${raw}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,csrf};}
 function login(){
  const state=token(),nonce=token(),verifier=token(),challenge=Buffer.from(hash(verifier),'hex').toString('base64url');
  store.db.prepare('DELETE FROM oauth_logins WHERE expires_at<?').run(Date.now());
  store.db.prepare('INSERT INTO oauth_logins VALUES(?,?,?,?)').run(hash(state),nonce,verifier,Date.now()+10*60000);
  const href=client.generateAuthUrl({scope:['openid','email','profile'],state,nonce,code_challenge:challenge,code_challenge_method:'S256',access_type:'online',prompt:'select_account'}).replaceAll('&','&amp;').replaceAll('"','&quot;');
  return {nonce:state,html:`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to LifeOS</title><style>body{margin:0;background:#071523;color:#e8f0f6;font:17px system-ui;min-height:100svh;display:grid;place-items:center}main{max-width:24rem;padding:2rem}h1{font-size:2.5rem;letter-spacing:-.04em}p{color:#aec1d1;line-height:1.6}a{display:inline-block;background:#cbdfef;color:#11253a;padding:.9rem 1.3rem;border-radius:.8rem;text-decoration:none;font-weight:650}</style><main><h1>LifeOS</h1><p>Sign in to your private workspace.</p><a href="${href}">Sign in with Google</a></main></html>`};
 }
 async function googleCode(req,params){
  const state=params.get('state'),cookie=cookies(req)['__Host-lifeos-login'];
  if(!state||!equal(state,cookie))throw new AppError('Sign-in verification failed',403,'login_csrf');
  if(params.has('error'))throw new AppError('Google sign-in was not completed. Please retry.',403,'google_auth');
  const code=params.get('code');if(!code||code.length>4096)throw new AppError('Google sign-in response is incomplete',403,'google_auth');
  const flow=store.transaction(()=>{const item=store.db.prepare('SELECT * FROM oauth_logins WHERE state_hash=? AND expires_at>?').get(hash(state),Date.now());if(item)store.db.prepare('DELETE FROM oauth_logins WHERE state_hash=?').run(hash(state));return item;});
  if(!flow)throw new AppError('This sign-in expired. Try again.',403,'google_auth');
  const tokens=exchangeCode?await exchangeCode({code,codeVerifier:flow.verifier}):(await client.getToken({code,codeVerifier:flow.verifier,redirect_uri:config.origin+'/auth/google'})).tokens;
  if(!tokens.id_token)throw new AppError('Google did not return a verified identity',403,'account_denied');
  const identity=await verify(tokens.id_token);if(!identityAllowed(identity,config,flow.nonce))throw new AppError('This account is not authorized',403,'account_denied');
  return issue(identity.email);
 }
 async function google(req,body){const form=new URLSearchParams(body);const c=cookies(req);if(!equal(c.g_csrf_token,form.get('g_csrf_token')))throw new AppError('Sign-in verification failed',403,'login_csrf');const p=await verify(form.get('credential'));const nonce=c['__Host-lifeos-login'];if(!identityAllowed(p,config,nonce))throw new AppError('This account is not authorized',403,'account_denied');return store.transaction(()=>{if(!store.db.prepare('DELETE FROM nonces WHERE id=? AND expires_at>?').run(nonce,Date.now()).changes)throw new AppError('This sign-in expired. Try again.',403);return issue(p.email);});}
 function csrf(req,s){if(req.headers.origin!==config.origin||!equal(req.headers['x-lifeos-csrf'],s.csrf))throw new AppError('Request origin or session verification failed',403,'csrf');}
 function logout(req){const raw=cookies(req)[name];if(raw)store.db.prepare('UPDATE sessions SET revoked=1 WHERE token_hash=?').run(hash(raw));return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;}
 return {session,issue,login,google,googleCode,csrf,logout};
}
