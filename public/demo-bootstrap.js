import {browserFetch} from './browser-demo-transport.js';
import {installDemoStorage} from './demo-storage.js';
import {createBrowserWorkspace} from './vendor/browser-demo/client.mjs';
// Local persistence is established before any app module can recover a draft.
window.__LIFEOS_BROWSER_DEMO__=true;
const workspace=createBrowserWorkspace(),nativeFetch=window.fetch.bind(window);
try{
 await workspace.ready;
 installDemoStorage(window,'lifeos-browser-local-workspace-v1'.padEnd(43,'_'));
 window.fetch=browserFetch(workspace,{origin:location.origin,network:nativeFetch});
 navigator.serviceWorker.addEventListener('message',event=>{
  if(event.source!==navigator.serviceWorker.controller||event.data?.type!=='lifeos-local-api'||!event.ports[0])return;
  const port=event.ports[0];
  void(async()=>{try{const value=event.data,url=new URL(value.url);if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))throw Error('Invalid local request');const response=await workspace.fetch(new Request(url,{method:value.method,headers:value.headers,...(value.body?{body:value.body}:{})}));const body=await response.arrayBuffer();port.postMessage({status:response.status,headers:[...response.headers],body},[body]);}catch{port.postMessage({error:'The local workspace is unavailable. No data was uploaded.'});}finally{port.close();}})();
 });
 await navigator.serviceWorker.register('/browser-demo-sw.js',{scope:'/',updateViaCache:'none'});
 await navigator.serviceWorker.ready;
 if(!navigator.serviceWorker.controller?.scriptURL.endsWith('/browser-demo-sw.js'))await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Reload LifeOS to finish opening local storage.')),10000);const ready=()=>{if(navigator.serviceWorker.controller?.scriptURL.endsWith('/browser-demo-sw.js')){clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',ready);resolve();}};navigator.serviceWorker.addEventListener('controllerchange',ready);ready();});
 // Download links also stay on this device. Media URLs use the local service worker.
 document.addEventListener('click',event=>{const link=event.target.closest?.('a[href]');if(!link||event.defaultPrevented)return;const url=new URL(link.href,location.href);if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return;event.preventDefault();void(async()=>{const response=await workspace.fetch(new Request(url));if(!response.ok)throw Error('The local file could not be opened.');const href=URL.createObjectURL(await response.blob()),download=document.createElement('a');download.href=href;download.download=link.download||'lifeos-demo-file';download.click();setTimeout(()=>URL.revokeObjectURL(href),1000);})().catch(()=>{document.querySelector('#global-notice').textContent='The local file could not be opened. Your saved work remains on this device.';});});
 await import('./app.js');
}catch(error){document.querySelector('#main').textContent=error.message||'This browser could not open local storage. No edits were uploaded.';}
