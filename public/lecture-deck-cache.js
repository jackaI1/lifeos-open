import {readDeckBytes} from './lecture-deck-updates.js';
export async function cachedLectureDeck({store,lectureId,source,fetcher=fetch}){
 const key='deck:'+lectureId+':'+source.id;
 try{const response=await fetcher(`/api/lectures/${lectureId}/sources/${source.id}/0`,{credentials:'same-origin'});if(response.status===401||response.status===403)throw Object.assign(Error('Sign in to open the saved slides.'),{auth:true});const bytes=await readDeckBytes(response,24*1024*1024);await store.mutate({puts:[[key,{bytes,sourceId:source.id}],[key+':receipt',{title:source.data.title,lectureId,sourceId:source.id,bytes:bytes.byteLength,savedAt:new Date().toISOString()}]]});return bytes;}catch(e){if(e.auth)throw e;const local=await store.get(key);if(local?.bytes)return local.bytes;throw e;}
}
