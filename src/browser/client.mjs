/** All API requests use a worker; no visitor request is forwarded to a server. */
export function createBrowserWorkspace({workerURL=new URL('./worker.mjs',import.meta.url),WorkerClass=Worker}={}){
 const worker=new WorkerClass(workerURL,{type:'module',name:'lifeos-browser-workspace'}),pending=new Map();let sequence=0,closed=false;
 const failure=message=>{for(const item of pending.values())item.reject(Error(message));pending.clear();};
 worker.onmessage=({data})=>{const item=pending.get(data.id);if(!item)return;pending.delete(data.id);if(data.type==='error')item.reject(Error(data.error));else item.resolve(data);};
 worker.onerror=()=>failure('The browser workspace could not start. Reload this page to retry.');
 const call=(message,transfer=[])=>new Promise((resolve,reject)=>{if(closed){reject(Error('The browser workspace is closed.'));return;}const id=++sequence;pending.set(id,{resolve,reject});try{worker.postMessage({id,...message},transfer);}catch(error){pending.delete(id);reject(error);}});
 const ready=call({type:'init'});
 return {ready,worker,async fetch(input,init){await ready;const request=input instanceof Request&&!init?input:new Request(new URL(typeof input==='string'?input:input.url,location.href),init);const url=new URL(request.url);if(url.origin!==location.origin||!/^\/(api\/|auth\/)/.test(url.pathname))throw Error('Browser workspace API destination denied');if(request.signal.aborted)throw request.signal.reason;const body=['GET','HEAD'].includes(request.method)?null:await request.arrayBuffer();const response=await call({type:'fetch',url:request.url,method:request.method,headers:[...request.headers],body},body?[body]:[]);return new Response([101,204,205,304].includes(response.status)?null:response.body,{status:response.status,statusText:response.statusText,headers:response.headers});},close(){if(closed)return;closed=true;failure('The browser workspace closed.');worker.terminate();}};
}
