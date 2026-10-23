import {installDemoStorage} from './demo-storage.js';
// Establish the visitor generation before importing ANY app/recovery module.
const nativeFetch=window.fetch.bind(window);
try{
 const response=await nativeFetch('/api/session');if(!response.ok)throw Error('The demo is unavailable. Reload to try again.');
 const session=await response.json(),generation=session.csrf;installDemoStorage(window,generation);
 window.fetch=async(input,init)=>{
  const request=new Request(new URL(typeof input==='string'?input:input.url,location.href),typeof input==='string'?init:input);if(typeof input!=='string'&&init)throw Error('Unsupported demo request');
  const api=new URL(request.url).origin===location.origin&&new URL(request.url).pathname.startsWith('/api/');
  if(api)request.headers.set('x-lifeos-demo-generation',generation);
  const result=await nativeFetch(request);
  if(api&&new URL(request.url).pathname==='/api/session'&&result.ok&&(await result.clone().json()).csrf!==generation)throw Error('This demo was reset or expired in another tab. Reload to start fresh.');
  return result;
 };
 await import('./demo-mode.js');await import('./app.js');
}catch(error){document.querySelector('#main').textContent=error.message;}
