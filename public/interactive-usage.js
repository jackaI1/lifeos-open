import {el,button} from './ui.js';
import {compactDisclosure,controlIcon} from './quiet-controls.js';
let cached=null,fetchedAt=0,inFlight=null,lastRequest=0;
const date=at=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(at);
export function usageIndicator(ctx){
 if(ctx.capabilities?.usage!==true)return {node:null,refresh:async()=>{},destroy(){}};
 let disposed=false,value=null,expiry,recheck;
 const detail=()=>el('div',{class:'usage-details'},value?.color&&value.color!=='unknown'?[el('strong',{},`${value.remaining.toFixed(0)}% remaining`),el('span',{},`${value.perDay.toFixed(1)}% per day until reset`),el('span',{},`Weekly reset ${date(value.resetAt)}`),value.blockedUntil?el('span',{},`Chat waits until ${date(value.blockedUntil)}`):null,el('small',{},`Checked ${date(value.checkedAt)}`)]:el('span',{},'Waiting for a current quota check'),button('Refresh',async()=>{await ctx.request('/api/quota/refresh',{method:'POST',body:{}});lastRequest=Date.now();cached=null;await refresh(true);clearTimeout(recheck);recheck=setTimeout(()=>!disposed&&void refresh(true),5000);},'text-button'));
 const pop=compactDisclosure({label:'AI usage',icon:'usage',content:detail});pop.node.classList.add('interactive-usage');
 function paint(){if(disposed)return;const state=value?.color??'unknown';pop.trigger.dataset.usage=state;pop.trigger.replaceChildren(controlIcon('usage'));pop.trigger.setAttribute('aria-label',state==='unknown'?'AI usage unknown':`AI usage: ${value.remaining.toFixed(0)}% remaining, ${value.perDay.toFixed(1)}% per day${state==='red'?', below your daily target':''}`);pop.refresh();clearTimeout(expiry);if(value?.checkedAt&&state!=='unknown')expiry=setTimeout(()=>{value={...value,color:'unknown'};paint();},Math.max(100,value.checkedAt+120000-Date.now()));}
 async function refresh(force=false){try{if(force||!cached||Date.now()-fetchedAt>30000){inFlight??=ctx.request('/api/quota/interactive').then(v=>{cached=v;fetchedAt=Date.now();return v;}).finally(()=>{inFlight=null;});await inFlight;}value=cached;paint();if(value?.color==='unknown'&&Date.now()-lastRequest>120000){lastRequest=Date.now();await ctx.request('/api/quota/refresh',{method:'POST',body:{}});clearTimeout(recheck);recheck=setTimeout(()=>!disposed&&void refresh(true),30000);}}catch{value=null;paint();}}
 const visible=()=>{if(!document.hidden)void refresh();};document.addEventListener('visibilitychange',visible);pop.trigger.addEventListener('click',()=>void refresh());void refresh();
 return {node:pop.node,refresh,destroy(){disposed=true;clearTimeout(expiry);clearTimeout(recheck);document.removeEventListener('visibilitychange',visible);pop.destroy();}};
}
