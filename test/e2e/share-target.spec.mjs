import {assert,go,button,visible,saved} from './helpers.mjs';
export default async function({page:p}){
 await go(p,'today');
 await p.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
 await p.reload({waitUntil:'networkidle'});
 await p.goto(p.origin+'/share-target/?title='+encodeURIComponent('Synthetic shared article')+'&text='+encodeURIComponent('Synthetic summary of the reading')+'&url='+encodeURIComponent('https://example.com/synthetic-reading'),{waitUntil:'networkidle'});
 await visible(p,'Shared from another app');
 assert.equal(await p.getByLabel('Title',{exact:true}).inputValue(),'Synthetic shared article');
 assert.match(await p.getByLabel('Text',{exact:true}).inputValue(),/Synthetic summary of the reading\n\nhttps:\/\/example\.com\/synthetic-reading/);
 await button(p,'Save as study note').click();
 await saved(p);
 const titles=await p.evaluate(async()=>(await (await fetch('/api/learning-notes')).json()).items.map(item=>item.data.title));
 assert.ok(titles.includes('Synthetic shared article'),'the shared item must be saved as a study note');
 const pending=await p.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('lifeos-share-inbox',1);r.onsuccess=()=>{const q=r.result.transaction('items','readonly').objectStore('items').get('latest');q.onsuccess=()=>{r.result.close();resolve(q.result??null);};q.onerror=()=>reject(q.error);};r.onerror=()=>reject(r.error);}));
 assert.equal(pending,null,'the inbox must be empty after saving');
}
