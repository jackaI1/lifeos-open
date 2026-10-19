import {httpsOrigin} from './shared/service-config.mjs';
import {publicNotice} from './public-notices.mjs';
const reply=(message,status)=>new Response(message,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const security={
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
 'Strict-Transport-Security':'max-age=31536000',
 'Permissions-Policy':'camera=(), geolocation=(), microphone=(self)',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'none'; connect-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'; manifest-src 'self'"
};
function hardened(response){const h=new Headers(response.headers);for(const[k,v]of Object.entries(security))h.set(k,v);return new Response(response.body,{status:response.status,headers:h});}
async function upstream(request,env,path,method=request.method){
 const target=new URL(env.TUNNEL_ORIGIN);const current=new URL(request.url);target.pathname=path;target.search=current.search;
 const headers=new Headers();for(const key of ['cookie','content-type','origin','x-lifeos-csrf','x-mutation-id','x-content-sha256','accept',...(path==='/api/presence'?['authorization']:[])]){const value=request.headers.get(key);if(value)headers.set(key,value);}
 headers.set('X-LifeOS-Gateway',env.GATEWAY_SECRET);headers.set('X-LifeOS-Origin',env.APP_ORIGIN);headers.set('X-LifeOS-Client',request.headers.get('CF-Connecting-IP')??'unknown');
 return fetch(target,{method,headers,body:['GET','HEAD'].includes(method)?undefined:request.body,redirect:'manual',signal:AbortSignal.timeout(20000)});
}
export default {async fetch(request,env){
 try{
  const url=new URL(request.url);
  if(!env.GATEWAY_SECRET||env.GATEWAY_SECRET.length<32||!env.TUNNEL_ORIGIN||!env.APP_ORIGIN)return reply('Private service configuration is incomplete.',503);
  if(url.origin!==env.APP_ORIGIN)return reply('Not found',404);
  const notice=request.method==='GET'?publicNotice(url.pathname):null;if(notice)return hardened(new Response(notice,{headers:{'Content-Type':'text/html; charset=utf-8'}}));
  if(url.pathname.startsWith('/internal/')||url.pathname.includes('..')||url.pathname.includes('\\')||/%(?:2e|2f|5c|00)/i.test(url.pathname))return reply('Not found',404);
  const length=Number(request.headers.get('content-length')??0);if(length>8*1024*1024)return reply('Request too large',413);
  if(url.pathname==='/auth/login'&&request.method==='GET'||url.pathname==='/auth/google'&&['GET','POST'].includes(request.method))return hardened(await upstream(request,env,url.pathname));
  if(url.pathname.startsWith('/api/'))return hardened(await upstream(request,env,url.pathname));
  if(!['GET','HEAD'].includes(request.method))return reply('Method not allowed',405);
  const allowed=await upstream(request,env,'/internal/authorize','GET');
  if(!allowed.ok){if(allowed.status===401&&request.headers.get('accept')?.includes('text/html'))return hardened(new Response(null,{status:303,headers:{Location:'/auth/login'}}));return hardened(allowed);}
  if(url.pathname==='/beta'&&env.ENVIRONMENT==='production'){if(!env.BETA_ORIGIN)return reply('Configure the isolated beta destination',503);return hardened(new Response(null,{status:303,headers:{Location:httpsOrigin(env.BETA_ORIGIN)}}));}
  return hardened(await env.ASSETS.fetch(request));
 }catch{return reply('Your computer is temporarily unavailable. Unsaved work on this device has not been sent. Please retry when the computer is online.',503);}
}};
