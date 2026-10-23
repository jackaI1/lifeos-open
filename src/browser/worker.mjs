import initSqlJs from 'sql.js/dist/sql-wasm.js';
import {Buffer} from 'buffer';
import {createBrowserService} from './service.mjs';
import {openWorkspaceDatabase,readWorkspace,writeWorkspace,withWorkspaceLock} from './persistence.mjs';
const nativeFetch=globalThis.fetch.bind(globalThis),origin=self.location.origin;
const assets=new Map([
 ['public/demo-lecture.wav','/demo-lecture.wav'],['public/demo-slides.pdf','/demo-slides.pdf'],['public/demo-landscape.jpg','/demo-landscape.jpg']
]);
let initialized,storage,SQL,serial=Promise.resolve();
async function readAsset(name){const path=assets.get(name);if(!path)throw Error('Unknown browser demo asset');const response=await nativeFetch(new URL(path,origin),{credentials:'omit',cache:'force-cache'});if(!response.ok)throw Error('The example assets could not load. Reload to retry.');return Buffer.from(await response.arrayBuffer());}
async function initialize(){
 const wasm=await nativeFetch(new URL('./sql-wasm.wasm',self.location.href),{credentials:'omit',cache:'force-cache'});if(!wasm.ok)throw Error('The browser database engine could not load.');
 SQL=await initSqlJs({wasmBinary:await wasm.arrayBuffer()});storage=await openWorkspaceDatabase();
 // Never allow an application route to turn a local request into a network request.
 globalThis.fetch=async()=>{throw Error('External requests are disabled in the browser workspace.');};
 return {storage:'browser',csrf:'browser-local-workspace'};
}
async function operate(message){
 if(!initialized)initialized=initialize().catch(error=>{initialized=null;throw error;});const info=await initialized;
 if(message.type==='init')return {type:'ready',...info};
 if(message.type!=='fetch')throw Error('Unknown browser workspace operation');
 return withWorkspaceLock(async()=>{
  const saved=await readWorkspace(storage),service=await createBrowserService({SQL,origin,bytes:saved?.bytes,readAsset});
  try{
   const headers=new Headers(message.headers);headers.set('origin',origin);headers.set('x-lifeos-csrf',service.csrf);
   const method=message.method??'GET',url=new URL(message.url,origin);if(url.origin!==origin||!/^\/(api\/|auth\/)/.test(url.pathname))throw Error('Only local workspace requests are supported.');
   const request=new Request(url,{method,headers,...(!['GET','HEAD'].includes(method)&&message.body?.byteLength?{body:message.body}:{})});
   const before=service.db.exec('SELECT total_changes() AS count')[0].values[0][0];
   const response=await service.fetch(request),body=await response.arrayBuffer();
   const changed=service.db.exec('SELECT total_changes() AS count')[0].values[0][0]!==before;
   // Acknowledge mutations only after IndexedDB commits, including binary objects.
   if(!saved||changed)await writeWorkspace(storage,service.db.export());
   return {type:'response',status:response.status,statusText:response.statusText,headers:[...response.headers],body};
  }finally{service.close();}
 });
}
self.onmessage=event=>{const message=event.data,id=message?.id;const operation=serial.then(()=>operate(message));serial=operation.catch(()=>{});operation.then(result=>self.postMessage({id,...result},result.body?[result.body]:[]),error=>self.postMessage({id,type:'error',error:error?.message??'Browser storage could not save. Your request was not uploaded.'}));};
self.onclose=()=>storage?.close();
