import webpush from 'web-push';import {unprotect}from'./secrets.mjs';import{hash}from'./store.mjs';
export function quietNow(now,preferences={}){const p=new Intl.DateTimeFormat('en-GB',{timeZone:preferences.timezone??'America/Toronto',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now));const a=preferences.quietStart??'22:00',b=preferences.quietEnd??'06:30';return a===b?false:a<b?p>=a&&p<b:p>=a||p<b;}
export async function sendPrivateNotification({store,config,id,route='today',explicitTest=false,now=new Date().toISOString(),sender,readKeys=unprotect}){
 if(!['today','support','prayer','devotional','school'].includes(route))route='today';
 const prefs=store.get('settings','preferences')?.data??{};
 if(!explicitTest&&quietNow(now,prefs))return{status:'quiet-hours',delivered:0};
 const subscriptions=store.list('push-subscription').filter(s=>!s.data.disabled);if(!subscriptions.length)return{status:'not-subscribed',delivered:0};
 if(!config.pushKeyFile||!config.pushPublicKey)return{status:'not-configured',delivered:0};
 const keys=await readKeys(config.pushKeyFile);let delivered=0,failed=0,retryable=0;
 for(const s of subscriptions){const deliveryId=hash(id+':'+s.id);if(store.meta('push:'+deliveryId))continue;
  try{await(sender??webpush.sendNotification)(s.data,JSON.stringify({id,route}),{TTL:3600,urgency:'normal',timeout:15000,vapidDetails:{subject:config.origin,publicKey:config.pushPublicKey,privateKey:keys.privateKey}});store.transaction(()=>{store.meta('push:'+deliveryId,{at:now});store.upsertInternal('notification',id,{route,createdAt:now,status:'provider-accepted',message:'You have an update in your private workspace.'},'notification-worker');});delivered++;}
  catch(error){failed++;if([404,410].includes(error.statusCode))store.transaction(()=>store.upsertInternal('push-subscription',s.id,{...s.data,disabled:true,disabledAt:now},'expired-push-subscription'));else retryable++;}
 }
 // Successful subscriptions keep their durable marker. Throwing leaves failed
 // deliveries in the worker's bounded retry flow without sending those again.
 if(retryable)throw Object.assign(new Error('Some private notifications could not be delivered. Saved delivery receipts will be used when retrying.'),{code:'push_delivery_retry',delivered,failed,retryable});
 return{status:failed?'delivery-incomplete':delivered?'provider-accepted':'already-sent',delivered,failed,deviceConfirmed:false};
}
