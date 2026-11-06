import {randomUUID,createHash} from 'node:crypto';
import {createClient} from 'redis';

type Client=ReturnType<typeof createClient>;
type ReadOptions={kind:string;id?:string;limit?:number;offset?:number;revision:()=>Promise<number|string>;load:()=>Promise<any>};
const TIMEOUT_MS=100,RETRY_MS=1000,TTL_SECONDS=60,MAX_BYTES=2*1024*1024;

/** Redis is disposable. SQL revisions, not cache deletion or expiry, decide freshness. */
export class RecordCache {
 readonly namespace=randomUUID();
 private url:string;
 private client:Client|null=null;
 private connecting:Promise<unknown>|null=null;
 private retryAt=0;
 private closed=false;
 constructor(url:string){this.url=url;}
 private async bounded<T>(operation:Promise<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Cache timeout')),TIMEOUT_MS);})]);}
  finally{clearTimeout(timer);}
 }
 private async command<T>(operation:(client:Client)=>Promise<T>):Promise<{ok:true;value:T}|{ok:false}>{
  if(this.closed||Date.now()<this.retryAt)return {ok:false};
  let client=this.client;
  try{
   if(!client){
    client=createClient({url:this.url,socket:{connectTimeout:TIMEOUT_MS,reconnectStrategy:false},disableOfflineQueue:true,commandsQueueMaxLength:32,commandOptions:{timeout:TIMEOUT_MS}});
    // Errors are handled at the command boundary; never log URLs or cached records.
    client.on('error',()=>{});this.client=client;
    this.connecting=client.connect();
   }
   if(this.connecting){await this.bounded(this.connecting);this.connecting=null;}
   return {ok:true,value:await this.bounded(operation(client))};
  }catch{
   if(client?.isOpen)client.destroy();
   if(this.client===client){this.client=null;this.connecting=null;this.retryAt=Date.now()+RETRY_MS;}
   return {ok:false};
  }
 }
 async read({kind,id,limit,offset,revision,load}:ReadOptions):Promise<{body:any;status:'hit'|'miss'|'bypass'}>{
  // Read from the authoritative DB even on hits. Includes inserts/deletes and worker writes.
  const before=await revision();
  const key=`lifeos:records:v1:${this.namespace}:`+createHash('sha256').update(JSON.stringify([kind,id??null,limit??null,offset??null,String(before)])).digest('hex');
  const cached=await this.command(client=>client.get(key));
  if(!cached.ok)return {body:await load(),status:'bypass'};
  if(cached.value!==null){
   let entry:any;
   try{entry=JSON.parse(cached.value);}catch{/* Invalid cache content is a miss. */}
   if(entry?.key===key&&entry.body&&typeof entry.body==='object'&&(id?entry.body.item?.kind===kind&&entry.body.item?.id===id:Array.isArray(entry.body.items))){
    // A write during the Redis round trip cannot turn a hit into an old response.
    // Database failures must propagate rather than being treated as Redis failures.
    if(String(await revision())===String(before))return {body:entry.body,status:'hit'};
    return {body:await load(),status:'bypass'};
   }
  }
  const body=await load();
  if(String(await revision())!==String(before))return {body,status:'bypass'};
  const value=JSON.stringify({key,body});
  if(Buffer.byteLength(value)>MAX_BYTES)return {body,status:'bypass'};
  const saved=await this.command(client=>client.set(key,value,{EX:TTL_SECONDS}));
  return {body,status:saved.ok?'miss':'bypass'};
 }
 close(){this.closed=true;if(this.client?.isOpen)this.client.destroy();this.client=null;}
}
