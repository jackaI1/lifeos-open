import {AppError} from '../shared/errors.mjs';
import {date} from '../server/validation.mjs';
import {boundedBytes} from './files.mjs';
export function prayerText(html){
 return String(html??'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\/(?:p|div|li|h[1-6])\s*>/gi,'\n\n').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,e)=>{const known={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};if(known[e])return known[e];const n=e[1]?.toLowerCase()==='x'?parseInt(e.slice(2),16):Number(e.slice(1));return Number.isInteger(n)&&n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
export async function dailyPrayer(day,{fetcher=fetch}={}){
 date(day);const [,m,d]=day.split('-').map(Number),response=await fetcher(`https://widget.operationworld.org/api/en/prayers/${m}/${d}`,{signal:AbortSignal.timeout(7000),redirect:'manual'});
 if(!response.ok)throw new AppError('Operation World returned HTTP '+response.status+'. Try again later.',503,'operation_world_provider');
 const data=JSON.parse(new TextDecoder().decode(await boundedBytes(response,220000)));
 if(!data.success||!Array.isArray(data.data)||!data.data.length||data.data.length>12)throw new AppError('The daily prayer is unavailable.',503);
 const items=data.data.map(x=>({title:prayerText(x.title).slice(0,160),text:prayerText(x.content)}));if(items.some(x=>!x.title||!x.text||x.text.length>40000))throw new AppError('The daily prayer could not be read.',503);
 return {day,items,source:'https://operationworld.org/',checkedAt:new Date().toISOString()};
}
export async function operationWorldRoute(req,{fetcher=fetch,cache=globalThis.caches?.default}={}){
 const url=new URL(req.url),day=date(url.searchParams.get('day')),key=new Request(url.origin+'/operation-world-cache-v1/'+day);
 // Cache failure must not discard a successfully retrieved public prayer.
 let saved;try{saved=await cache?.match(key);}catch{}if(saved)return saved;
 try{const value=await dailyPrayer(day,{fetcher}),response=Response.json(value,{headers:{'Cache-Control':'public, max-age=21600'}});try{await cache?.put(key,response.clone());}catch{}return response;}catch(e){if(e instanceof AppError)throw e;throw new AppError('Operation World is unavailable. Your prayer list is unchanged.',503,'operation_world_unavailable');}
}
