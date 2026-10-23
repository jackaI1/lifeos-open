const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode=(s:string)=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export const IDLE_MS=86400000;
export const randomVisitor=()=>encode(crypto.getRandomValues(new Uint8Array(32)));
const key=(secret:string)=>crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
export async function signVisitor(id:string,secret:string,now=Date.now()){
 if(!/^[A-Za-z0-9_-]{43}$/.test(id)||secret.length<32)throw Error('Invalid demo capability configuration');
 const payload=encode(new TextEncoder().encode(JSON.stringify({id,at:now}))),signature=await crypto.subtle.sign('HMAC',await key(secret),new TextEncoder().encode(payload));
 return payload+'.'+encode(new Uint8Array(signature));
}
export async function parseVisitorCookie(req:Request,secret:string,now=Date.now()){
 const raw=(req.headers.get('cookie')??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-lifeos-demo='))?.slice(19);
 if(!raw||raw.length>400||secret.length<32)return null;
 try{const [payload,sig,...extra]=raw.split('.');if(extra.length||!payload||!sig||!await crypto.subtle.verify('HMAC',await key(secret),decode(sig),new TextEncoder().encode(payload)))return null;
 const v=JSON.parse(new TextDecoder().decode(decode(payload)));return /^[A-Za-z0-9_-]{43}$/.test(v.id)&&Number.isSafeInteger(v.at)&&v.at<=now+60000&&v.at>now-IDLE_MS?v:null;
 }catch{return null;}
}
export const visitorCookie=(token:string)=>`__Host-lifeos-demo=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400`;
