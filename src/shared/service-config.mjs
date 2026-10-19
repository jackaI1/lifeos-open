/** Canonical operator-selected origin; never a credential-bearing URL or route. */
export function httpsOrigin(value){
 if(typeof value!=='string'||value.length>2048)throw new TypeError('Configured HTTPS origin is invalid');
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.port||url.search||url.hash)throw new TypeError('Configured HTTPS origin is invalid');
 return url.origin;
}
