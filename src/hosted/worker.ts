/** Public demo transport. Visitor work runs and stays in the browser. */
type DemoEnv={ASSETS:{fetch(request:Request):Promise<Response>};DEMO_ORIGIN:string;PARENT_ORIGIN:string};
function origin(value:string){
 const url=new URL(value);
 if(url.origin!==value||url.username||url.password||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw Error('Invalid demo origin');
 return url.origin;
}
export function validateStaticBindings(env:DemoEnv){
 if(Object.keys(env).some(key=>!['ASSETS','DEMO_ORIGIN','PARENT_ORIGIN'].includes(key))||!env.ASSETS||typeof env.ASSETS.fetch!=='function'||origin(env.DEMO_ORIGIN)===origin(env.PARENT_ORIGIN))throw Error('Invalid static demo configuration');
}
export function staticSecurityHeaders(parent:string){
 return {
  'content-security-policy':`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${origin(parent)}`,
  'referrer-policy':'no-referrer','x-content-type-options':'nosniff','permissions-policy':'camera=(), microphone=(self), geolocation=(), payment=()','cross-origin-resource-policy':'same-origin'
 };
}
function secure(response:Response,parent:string,head=false){
 const headers=new Headers(response.headers);headers.delete('set-cookie');headers.delete('x-frame-options');
 for(const [name,value]of Object.entries(staticSecurityHeaders(parent)))headers.set(name,value);
 return new Response(head?null:response.body,{status:response.status,headers});
}
const denied=(message:string,status:number)=>Response.json({error:message,code:'browser_only_demo'},{status,headers:{'cache-control':'no-store'}});
export default {
 async fetch(request:Request,env:DemoEnv){
  try{
   validateStaticBindings(env);
   const url=new URL(request.url),head=request.method==='HEAD';
   if(url.origin!==env.DEMO_ORIGIN)return secure(denied('Unknown demo origin',404),env.PARENT_ORIGIN,head);
   // Reject without consulting request headers, body, session, storage or services.
   if(!['GET','HEAD'].includes(request.method))return secure(new Response(null,{status:405,headers:{allow:'GET, HEAD','cache-control':'no-store'}}),env.PARENT_ORIGIN);
   if(url.pathname==='/api'||url.pathname.startsWith('/api/')||url.pathname==='/auth'||url.pathname.startsWith('/auth/'))return secure(denied('The public host has no API. Demo changes stay in this browser.',403),env.PARENT_ORIGIN,head);
   const shell=url.pathname==='/'||url.pathname==='/index.html';
   const asset=/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:js|mjs|css|png|jpg|jpeg|svg|ico|woff2?|ttf|json|webmanifest|pdf|wav|mp4|wasm|sql|html)$/.test(url.pathname)&&!url.pathname.includes('..');
   if(!shell&&!asset)return secure(denied('Demo asset not found',404),env.PARENT_ORIGIN,head);
   // A fresh request deliberately carries no visitor cookies or credentials.
   const assetURL=new URL(env.DEMO_ORIGIN+(shell?'/':url.pathname));
   let response=await env.ASSETS.fetch(new Request(assetURL,{method:shell?'GET':request.method}));
   if(shell&&response.ok){
    const html=(await response.text()).replace(/src="\/app\.js"/g,'src="/demo-bootstrap.js"'),headers=new Headers(response.headers);
    for(const name of ['content-length','content-encoding','etag'])headers.delete(name);
    headers.set('cache-control','public, max-age=0, must-revalidate');
    response=new Response(html,{status:response.status,headers});
   }
   return secure(response,env.PARENT_ORIGIN,head);
  }catch{
   return new Response(request.method==='HEAD'?null:'The static demo is temporarily unavailable.',{status:503,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'}});
  }
 }
};
