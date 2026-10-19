import {LectureStorage} from './lecture-storage.js';
// A second tab writes an isolated recoverable draft, never another tab's local journal.
export async function editableLectureStore(base,id){
 const pointer='lecture-draft-store:'+base.name+':'+id;
 let preferred;try{preferred=sessionStorage.getItem(pointer);}catch{}
 let store=preferred?await new LectureStorage(preferred).open():base;
 const claim=async name=>{if(!navigator.locks)return null;let release;const acquired=await new Promise(resolve=>{navigator.locks.request(name,{ifAvailable:true},async lock=>{if(!lock){resolve(false);return;}await new Promise(done=>{release=done;resolve(true);});}).catch(()=>resolve(false));});return acquired?release:null;};
 let release=await claim('lifeos-lecture-'+id+(preferred?':'+preferred:''));
 if(release){if(store!==base)base.close();return {store,release};}
 const name=base.name+'-draft-'+crypto.randomUUID(),copy=await new LectureStorage(name).open();
 const prefixes=['lecture:'+id,'page:'+id+':','ink-state:'+id+':','ink-cache:'+id+':','ink-pending:'+id+':','notebook-layout:'+id,'epoch:'+id+':'];
 for(const prefix of prefixes){const keys=await store.keys(prefix,50000);for(let i=0;i<keys.length;i+=50){const batch=keys.slice(i,i+50),values=await store.getMany(batch);await copy.mutate({puts:batch.map((key,n)=>[key,values[n]]).filter(([,v])=>v!==undefined)});}}
 await base.put('draft-store:'+id+':'+name,{name,lectureId:id,createdAt:new Date().toISOString()});
 try{sessionStorage.setItem(pointer,name);}catch{}
 if(store!==base)store.close();base.close();store=copy;release=await claim('lifeos-lecture-'+id+':'+name);
 return {store,release:release??(()=>{})};
}
