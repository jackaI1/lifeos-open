/** Reconstruct an already validated, local-only RPC request. */
export function createWorkspaceRequest(message,{origin,csrf,RequestClass=Request}){
 const method=message.method??'GET',url=new URL(message.url,origin);
 if(url.origin!==origin||!/^\/(api\/|auth\/)/.test(url.pathname))throw Error('Only local workspace requests are supported.');
 const headers=new Headers(message.headers);headers.set('origin',origin);headers.set('x-lifeos-csrf',csrf);
 const request=new RequestClass(url,{method,headers,...(!['GET','HEAD'].includes(method)&&message.body?.byteLength?{body:message.body}:{})});
 // Browser Request constructors strip forbidden Origin headers. This object only
 // enters the in-process app handler: retain the independently validated local
 // origin for its existing CSRF checks without changing CloudAuth or networking.
 Object.defineProperty(request,'headers',{value:headers});
 return request;
}
