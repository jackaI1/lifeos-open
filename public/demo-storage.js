// Hosted demo only. Never installed in the personal or standalone app.
export function scopedStorage(storage,generation){
 const prefix='lifeos-demo:'+generation+':',keys=()=>Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>k?.startsWith(prefix)).map(k=>k.slice(prefix.length));
 const methods={getItem:key=>storage.getItem(prefix+key),setItem:(key,value)=>storage.setItem(prefix+key,value),removeItem:key=>storage.removeItem(prefix+key),key:index=>keys()[index]??null,clear:()=>keys().forEach(key=>storage.removeItem(prefix+key))};
 return new Proxy(Object.create(null),{get:(_,key)=>key==='length'?keys().length:key in methods?methods[key]:typeof key==='string'?methods.getItem(key):undefined,set:(_,key,value)=>{methods.setItem(key,value);return true;},deleteProperty:(_,key)=>{methods.removeItem(key);return true;},ownKeys:keys,getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});
}
export function scopedIndexedDB(database,generation){
 const prefix='lifeos-demo:'+generation+':';
 return new Proxy(database,{get:(target,key)=>key==='open'?(name,...args)=>target.open(prefix+name,...args):key==='deleteDatabase'?name=>target.deleteDatabase(prefix+name):key==='databases'?async()=> (await target.databases()).filter(v=>v.name?.startsWith(prefix)).map(v=>({...v,name:v.name.slice(prefix.length)})):typeof target[key]==='function'?target[key].bind(target):target[key]});
}
export function installDemoStorage(scope,generation){
 if(!/^[\w-]{43}$/.test(generation))throw Error('The demo session could not be verified. Reload to try again.');
 for(const name of ['localStorage','sessionStorage'])Object.defineProperty(scope,name,{value:scopedStorage(scope[name],generation),configurable:true});
 Object.defineProperty(scope,'indexedDB',{value:scopedIndexedDB(scope.indexedDB,generation),configurable:true});
}
