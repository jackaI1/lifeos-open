// Serve media/download API resources from the current page's local workspace.
// There is deliberately no network fallback for any API request.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||!(url.pathname==='/api'||url.pathname.startsWith('/api/')))return;
 event.respondWith((async()=>{
  const client=await self.clients.get(event.clientId);
  if(!client)return new Response('Open LifeOS to access this device’s demo files.',{status:503});
  const channel=new MessageChannel();
  const reply=new Promise(resolve=>{
   const timer=setTimeout(()=>{channel.port1.close();resolve(new Response('Local workspace did not respond. Keep this page open and try again.',{status:503}));},30000);
   channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();const value=event.data;if(value.error){resolve(new Response(value.error,{status:503}));return;}resolve(new Response(value.status===204||value.status===304?null:value.body,{status:value.status,headers:value.headers}));};
  });
  const body=['GET','HEAD'].includes(event.request.method)?null:await event.request.arrayBuffer();
  client.postMessage({type:'lifeos-local-api',url:event.request.url,method:event.request.method,headers:[...event.request.headers],body},[channel.port2,...(body?[body]:[])]);
  return reply;
 })());
});
