export function backgroundEnabled(env){return env?.BACKGROUND_ENABLED!=='false';}
export async function conservingWrites(store,now=Date.now()){
 const until=await store.meta('d1-conservation-until');return Number.isFinite(until)&&until>now;
}
export const D1_CONSERVATION_REASON='Waiting to protect today\'s database allowance; request saved';
export function modelRecheckAt(decision,now=Date.now()){
 const delay=decision.mode==='busy'?5000:decision.mode==='normal'?60000:15*60000;
 return Math.max(now+delay,decision.resetAt??0);
}
