// API requests never fall back to a website, even when local persistence fails.
export function browserFetch(workspace,{origin=location.origin,network=globalThis.fetch.bind(globalThis)}={}){
 return async(input,init)=>{
  const request=input instanceof Request?new Request(input,init):new Request(new URL(input instanceof URL?input.href:input,origin),init);
  const url=new URL(request.url);
  if(url.origin!==origin)throw new TypeError('This demo uses only files on this site and data on this device.');
  if(url.pathname==='/api'||url.pathname.startsWith('/api/'))return workspace.fetch(request);
  if(!['GET','HEAD'].includes(request.method))throw new TypeError('The public demo never uploads changes.');
  return network(request);
 };
}
