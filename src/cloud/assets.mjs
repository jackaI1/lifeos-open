import {AppError} from '../shared/errors.mjs';

// Called only after the owner session check. Code URLs change as one release;
// relative ESM imports then stay inside that release namespace automatically.
export async function workspaceAsset(request,env){
 const url=new URL(request.url),version=String(env.RELEASE_COMMIT??''),scoped=url.pathname.match(/^\/__assets\/([a-f0-9]{40})(\/.*)$/);
 if(url.pathname.startsWith('/__assets/')){
  if(!scoped||!/^\/[A-Za-z0-9_./-]+\.(?:js|mjs|css)$/.test(scoped[2])||scoped[2].includes('..'))throw new AppError('Not found',404);
  // These vendor modules have never changed at these paths. Open lectures and
  // chats lazy-load them after deployment. Hash tests pin each dependency pair;
  // future upgrades must use new paths, not overwrite these originals.
  const pinnedVendor=['/vendor/pdfjs/pdf.mjs','/vendor/pdfjs/pdf.worker.mjs','/vendor/katex/katex.mjs','/vendor/katex/contrib/auto-render.mjs'].includes(scoped[2]);
  if(scoped[1]!==version&&!pinnedVendor)throw new AppError('This app version has changed. Reload the page to continue.',409,'app_version_changed');
  url.pathname=scoped[2];const result=await env.ASSETS.fetch(new Request(url,request));
  if(result.headers.get('content-type')?.includes('text/html'))throw new AppError('Not found',404);
  return result;
 }
 const headers=new Headers(request.headers);headers.delete('if-none-match');headers.delete('if-modified-since');
 const response=await env.ASSETS.fetch(new Request(request,{headers}));
 if(request.method==='HEAD'||response.status!==200||!response.headers.get('content-type')?.includes('text/html')||!/^[a-f0-9]{40}$/.test(version))return response;
 const prefix='/__assets/'+version,html=(await response.text()).replace(/\b(src|href)="(\/[A-Za-z0-9_./-]+\.(?:js|mjs|css))"/g,(_,attr,path)=>`${attr}="${prefix}${path}"`),out=new Headers(response.headers);
 out.delete('content-length');out.delete('etag');out.set('cache-control','no-store');
 return new Response(html,{status:200,headers:out});
}
