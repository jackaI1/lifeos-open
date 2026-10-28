// Never cache navigations, private API responses or identity flows. Authentication remains server-side.
const CACHE = 'lifeos-inert-v3';
const INERT = new Set(['/styles.css','/assistant-chat.css','/workspace-design.css','/lecture-workspace.css','/private-moments.css','/notes-friends.css','/fonts/Barlow-Regular.woff2','/fonts/Barlow-Medium.woff2','/fonts/Barlow-SemiBold.woff2','/fonts/BarlowSemiCondensed-Medium.woff2','/fonts/BarlowSemiCondensed-SemiBold.woff2', '/icons/icon-192.png', '/manifest.webmanifest','/icons/icon-512.png','/icons/apple-touch-icon.png','/icons/maskable-512.png','/icons/favicon.png']);
self.addEventListener('install', () => {}); // Waiting updates never interrupt writing or recording.
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('lifeos-inert-') && key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !INERT.has(url.pathname)) return;
  event.respondWith(fetch(event.request).then(async response => { if (response.ok && response.type === 'basic') { const cache = await caches.open(CACHE); await cache.put(event.request, response.clone()); } return response; }).catch(async () => (await caches.match(event.request)) || Response.error()));
});
async function claimNotice(id,expiresAt){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('lifeos-notification-receipts',1);r.onupgradeneeded=()=>r.result.createObjectStore('seen');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction('seen','readwrite'),store=tx.objectStore('seen'),request=store.get(id);let fresh=false;request.onsuccess=()=>{if(!request.result){store.put(expiresAt,id);fresh=true;}const cursor=store.openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(c){if(c.value<Date.now())c.delete();c.continue();}};};tx.oncomplete=()=>resolve(fresh);tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
self.addEventListener('push', event => {
 let message={};try{message=event.data?.json()||{};}catch{}
 const bodies={'hourly-prayer':'Take a moment to pray.','practice-due':message.route==='prayer'?'Prayer is still due today.':'Devotional is still due today.','reply-ready':'Your LifeOS assistant has replied.','reminder-due':'A saved reminder is due.',test:'LifeOS notifications are connected.'};
 if(!Object.hasOwn(bodies,message.notice)||typeof message.id!=='string'||message.expiresAt&&Date.now()>=message.expiresAt)return;
 event.waitUntil((async()=>{
  if(!await claimNotice(message.id,Date.now()+2*86400000))return;
  if(message.notice==='hourly-prayer')for(const old of await self.registration.getNotifications({tag:'lifeos-hourly-prayer'}))old.close();
  await self.registration.showNotification('LifeOS',{body:bodies[message.notice],icon:'/icons/icon-192.png',tag:message.notice==='hourly-prayer'?'lifeos-hourly-prayer':message.id.slice(0,100),renotify:false,requireInteraction:false,vibrate:[150],data:{route:['today','support','prayer','devotional','school','reminders'].includes(message.route)?message.route:'today'}});
 })());
});
self.addEventListener('notificationclick', event => { event.notification.close(); const url = new URL(`/#${event.notification.data?.route || 'today'}`, self.location.origin).href; event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => { const tab = windows.find(window => new URL(window.url).origin === self.location.origin); if (tab) { tab.navigate(url); return tab.focus(); } return self.clients.openWindow(url); })); });
