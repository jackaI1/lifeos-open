import {captureCookingHelpIntent,createCookingHelpRequest,validateCookingHelpResult} from './cooking-help-contract.js';

const clone=value=>structuredClone(value),uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const dated=value=>typeof value==='string'&&Number.isFinite(Date.parse(value)),stamp=()=>new Date().toISOString(),bytes=value=>new TextEncoder().encode(value).byteLength;
// Inspect descriptors before cloning or serialization. A live oversized original
// stays reachable, but it cannot be presented as a bounded physical receipt.
function json(value,{live=false}={}){
 try{let nodes=0;const ancestors=new Set(),pending=[{value,depth:0}];while(pending.length){const row=pending.pop(),v=row.value;if(row.exit){ancestors.delete(v);continue;}if(++nodes>25000&&!live||row.depth>64)return false;
  if(v===null||typeof v==='string'||typeof v==='boolean')continue;if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))return false;continue;}
  if(typeof v!=='object'||ancestors.has(v)||Object.getPrototypeOf(v)!==(Array.isArray(v)?Array.prototype:Object.prototype))return false;
  const keys=Reflect.ownKeys(v),array=Array.isArray(v);if(array&&(keys.length!==v.length+1||keys.at(-1)!=='length')||keys.length>25000&&!live)return false;
  ancestors.add(v);pending.push({value:v,exit:true});for(const key of keys){if(array&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(v,key);if(typeof key!=='string'||array&&!/^(0|[1-9]\d*)$/.test(key)||!d?.enumerable||!Object.hasOwn(d,'value'))return false;pending.push({value:d.value,depth:row.depth+1});}
 }return live||bytes(JSON.stringify(value))<=4*1024*1024;}catch{return false;}
}
const same=(a,b)=>{if(!json(a,{live:true})||!json(b,{live:true}))return false;const pending=[[a,b]];while(pending.length){const [x,y]=pending.pop();if(Object.is(x,y))continue;if(x===null||y===null||typeof x!=='object'||typeof y!=='object'||Array.isArray(x)!==Array.isArray(y))return false;const keys=Object.keys(x);if(keys.length!==Object.keys(y).length)return false;for(const key of keys){if(!Object.hasOwn(y,key))return false;pending.push([x[key],y[key]]);}}return true;};
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),n=>n.toString(16).padStart(2,'0')).join('');}
const sameStamp=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
const route=id=>'#reminders?view=cooking&session='+id;
const statuses=new Set(['queued','running','needs-input','completed','late-result','uncertain','expired','failed','cancelled','unavailable']);
const fields=(value,keys)=>json(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
function errorOutcome(original){
 try{if(original===null||typeof original!=='object')return json(original)?{originalError:clone(original)}:{originalError:original};const descriptors=Object.getOwnPropertyDescriptors(original),data={};
  // Native Error.stack is a lazy nonenumerable accessor. It is diagnostic state,
  // not a returned API payload; retain message and all enumerable own data only.
  for(const key of Reflect.ownKeys(descriptors)){const d=descriptors[key];if(!d.enumerable&&!['message','status','code'].includes(key))continue;if(typeof key!=='string'||!Object.hasOwn(d,'value')||!json(d.value,{live:true}))return{originalError:original};Object.defineProperty(data,key,{value:clone(d.value),enumerable:true,configurable:true,writable:true});}
  return{message:typeof data.message==='string'?data.message:'The original request outcome is unknown.',...(Number.isInteger(data.status)?{status:data.status}:{}),...(typeof data.code==='string'?{code:data.code}:{}),originalErrorData:{representation:'own-message-and-enumerable-data-fields',fields:data}};
 }catch{return{originalError:original};}
}
const refused=()=>Error('Keep the original question and save the exact current cooking selection on this device before trying.');
function budget(ms){return{deadline:performance.now()+ms,expired:false};}
async function within(job,promise){
 const remaining=job.deadline-performance.now();if(job.expired||remaining<=0){job.expired=true;throw refused();}
 let timer;try{const value=await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{job.expired=true;reject(refused());},remaining);})]);if(job.expired||performance.now()>=job.deadline){job.expired=true;throw refused();}return value;}finally{clearTimeout(timer);}
}

export class CookingHelp {
 constructor({sessions,request,getScope,onChange=()=>{},observationMs=30000,custodyWaitMs=2000}){
  const scope=getScope?.();if(!sessions||typeof request!=='function'||typeof getScope!=='function'||scope?.environment!=='beta'||typeof scope.owner!=='string'||!/^\S+@\S+\.\S+$/.test(scope.owner)||!Number.isFinite(observationMs)||observationMs<1||observationMs>30000||!Number.isFinite(custodyWaitMs)||custodyWaitMs<1||custodyWaitMs>2000)throw refused();
  Object.assign(this,{sessions,store:sessions.store,request,getScope,onChange,observationMs,custodyWaitMs,owner:scope.owner});this.prefix='local-cooking-help:v1:beta:'+encodeURIComponent(this.owner.trim().toLowerCase())+':';
  this.drafts=new Map();this.intents=new Map();this.facts=new Map();this.adoptions=new Map();this.recoveries=[];this.writes=new Set();this.preparing=new Map();this.actions=new Map();this.admitting=new Map();this.live=new Map();this.observers=new Set();this.adopting=new Map();this.initialSends=new WeakSet();this.epoch=0;this.disposed=false;
 }
 changed(){this.epoch++;if(!this.disposed)this.onChange();}
 key(v){return this.prefix+v.recordType+':'+(v.recordType==='intent'?v.requestId:v.recordType==='fact'?v.requestId+':'+v.factId:v.recordType==='adoption'?v.requestId:v.draftId);}
 async physical(key,value){
  if(!json(value)||typeof this.store.inspectPhysical!=='function'||typeof this.store.isDurable!=='function'||await this.store.isDurable(key,value.token)!==true)return false;
  const rows=(await this.store.inspectPhysical(key)).filter(r=>r.key===key);return rows.length>0&&rows.every(r=>!r.parseError&&!r.keyMismatch&&same(r.value,value));
 }
 async currentF(value){
  const key=this.sessions.key(value);if(!await this.sessions.physicallyRetained(value))return false;const rows=(await this.store.inspectPhysical(key)).filter(r=>r.key===key);if(!rows.length)return false;
  const latest=Math.max(...rows.map(r=>r.writtenAt||0));return rows.filter(r=>(r.writtenAt||0)===latest).every(r=>!r.parseError&&!r.keyMismatch&&same(r.value,value));
 }
 write(entry){
  entry.durable=false;entry.error=null;const value=entry.value,key=this.key(value);
  const task=(async()=>{try{if(!json(value))throw refused();const originals=(await this.store.inspectPhysical(key)).filter(r=>r.key===key);if(originals.some(r=>r.parseError||r.keyMismatch||!same(r.value,value)))throw refused();entry.durable=await this.store.put(key,value)===true&&await this.physical(key,value);if(!entry.durable)throw refused();return true;}catch{entry.durable=false;entry.error='This device has not retained the exact original. Keep it open or download it.';return false;}finally{this.changed();}})();
  entry.persistence=task;this.writes.add(task);this.changed();task.finally(()=>this.writes.delete(task));return task;
 }
 binding(entry,stepId){
  this.sessions.assertEntry(entry);const v=entry.value,step=v.steps.find(s=>s.id===stepId);if(!step||typeof v.source.data.recipe!=='string')throw refused();return{owner:this.owner,environment:'beta',cookId:v.cookId,branchId:v.branchId,source:{kind:v.source.kind,id:v.source.id,version:v.source.version,recipe:v.source.data.recipe},selectedStep:{id:step.id,text:step.text}};
 }
 matches(v,b){return v.owner===b.owner&&v.environment===b.environment&&v.cookId===b.cookId&&v.branchId===b.branchId&&same(v.source,b.source)&&same(v.selectedStep,b.selectedStep);}
 draft(entry,stepId){
  let b;try{b=this.binding(entry,stepId);}catch{return null;}const found=[...this.drafts.values()].filter(e=>this.matches(e.value,b)).sort((a,b)=>b.value.revision-a.value.revision);if(found.length>1&&found[0].value.revision===found[1].value.revision&&!same(found[0].value,found[1].value))return null;return found[0]??null;
 }
 setDraft(entry,input){
  const scope=this.getScope();if(this.disposed||scope?.owner!==this.owner||scope?.environment!=='beta'||scope.entry!==entry||!json(input,{live:true})||Object.keys(input).sort().join(',')!=='question,range,stepId'||typeof input.question!=='string'||!json(input.range,{live:true}))throw refused();
  const b=this.binding(entry,input.stepId),previous=this.draft(entry,input.stepId);if(previous&&previous.value.question===input.question&&same(previous.value.range,input.range))return previous;
  const draftId=crypto.randomUUID(),record={value:{schema:1,recordType:'draft',draftId,token:draftId,...clone(b),question:input.question,range:clone(input.range),revision:(previous?.value.revision??-1)+1,at:stamp()},durable:false,error:null};this.drafts.set(draftId,record);this.changed();this.write(record);return record;
 }
 witness(entry,stepId,draftToken,{historical=null}={}){
  if(!json(entry?.value))throw refused();const scope=this.getScope(),snapshot=clone(entry.value),selected=this.draft(entry,stepId),viewLease=scope?.viewLease,raw=scope?.rawUnsaved,routeHash=scope?.routeHash;
  if(!selected||selected.value.token!==draftToken||!viewLease||raw!==false||scope.entry!==entry||scope.stepId!==stepId||scope.environment!=='beta'||scope.owner!==this.owner||routeHash!==route(snapshot.cookId)||historical&&(!this.matches(selected.value,{owner:historical.owner,environment:historical.environment,cookId:historical.cookId,branchId:historical.branchId,source:{kind:historical.source.kind,id:historical.source.id,version:historical.source.version,recipe:historical.source.recipe},selectedStep:historical.selectedStep})||selected.value.question!==historical.question||!same(selected.value.range,historical.source.range)))throw refused();
  return{snapshot,draft:selected,still:()=>{const s=this.getScope();return !this.disposed&&!this.sessions.disposed&&s?.environment==='beta'&&s.owner===this.owner&&s.entry===entry&&s.stepId===stepId&&s.viewLease===viewLease&&s.rawUnsaved===raw&&s.routeHash===routeHash&&entry.value.token===snapshot.token&&same(entry.value,snapshot)&&this.draft(entry,stepId)===selected;}};
 }
 async validIntent(value){
  try{if(!fields(value,['schema','recordType','requestId','token','draftToken','intent','intentHash','bodyHash','at'])||value.schema!==1||value.recordType!=='intent'||value.requestId!==value.token||!uuid(value.requestId)||!uuid(value.draftToken)||!dated(value.at)||value.intent.owner!==this.owner)return false;const intent=captureCookingHelpIntent(value.intent),body=createCookingHelpRequest(intent);return intent.requestId===value.requestId&&await digest(intent)===value.intentHash&&await digest(body)===value.bodyHash;}catch{return false;}
 }
 validFact(v){const original=this.intents.get(v?.requestId)?.value;return fields(v,['schema','recordType','requestId','factId','token','attemptId','kind','method','at','intentHash','bodyHash','outcome'])&&v.schema===1&&v.recordType==='fact'&&uuid(v.factId)&&v.token===v.factId&&uuid(v.requestId)&&uuid(v.attemptId)&&['attempt','unknown','response','error','canceled-before-send','cancel-observation'].includes(v.kind)&&['POST','GET','CANCEL'].includes(v.method)&&dated(v.at)&&original&&v.intentHash===original.intentHash&&v.bodyHash===original.bodyHash;}
 validAdoption(v){const original=this.intents.get(v?.requestId)?.value;return fields(v,['schema','recordType','requestId','token','stepId','cookId','branchId','intentHash','bodyHash','at'])&&v.schema===1&&v.recordType==='adoption'&&uuid(v.token)&&uuid(v.requestId)&&uuid(v.stepId)&&uuid(v.branchId)&&uuid(v.cookId)&&dated(v.at)&&original&&v.intentHash===original.intentHash&&v.bodyHash===original.bodyHash&&v.cookId===original.intent.cookId&&v.branchId===original.intent.branchId;}
 ambiguous(id){return this.recoveries.some(r=>r.key===this.prefix+'intent:'+id||r.key===this.prefix+'adoption:'+id||r.key?.startsWith(this.prefix+'fact:'+id+':'));}
 async initialize(){
  const rows=await this.store.inspectPhysical(this.prefix),groups=new Map();for(const row of rows){const group=groups.get(row.key)??[];group.push(row);groups.set(row.key,group);}
  const later=[];for(const [key,group]of groups){const v=group[0].value;let valid=false;
   if(group.every(r=>!r.parseError&&!r.keyMismatch&&same(r.value,v))&&json(v)&&v?.schema===1&&uuid(v.token)&&key===this.key(v)&&await this.physical(key,v)){
    if(v.recordType==='draft')valid=fields(v,['schema','recordType','draftId','token','owner','environment','cookId','branchId','source','selectedStep','question','range','revision','at'])&&v.owner===this.owner&&v.environment==='beta'&&uuid(v.draftId)&&v.token===v.draftId&&uuid(v.cookId)&&uuid(v.branchId)&&fields(v.source,['kind','id','version','recipe'])&&v.source.kind==='meal'&&typeof v.source.id==='string'&&Number.isSafeInteger(v.source.version)&&v.source.version>0&&typeof v.source.recipe==='string'&&fields(v.selectedStep,['id','text'])&&uuid(v.selectedStep.id)&&typeof v.selectedStep.text==='string'&&typeof v.question==='string'&&Number.isSafeInteger(v.revision)&&v.revision>=0&&dated(v.at);
    else if(v.recordType==='intent')valid=await this.validIntent(v);
    else if(['fact','adoption'].includes(v.recordType)){later.push({key,group,v});continue;}
   }
   if(valid){const map=v.recordType==='draft'?this.drafts:v.recordType==='intent'?this.intents:v.recordType==='fact'?this.facts:this.adoptions;map.set(v.recordType==='draft'?v.draftId:v.recordType==='fact'?v.factId:v.requestId,{value:clone(v),durable:true,error:null,persistence:Promise.resolve(true)});}else this.recoveries.push(...group);
  }for(const {key,group,v}of later){if(v.recordType==='fact'?this.validFact(v):this.validAdoption(v)){const map=v.recordType==='fact'?this.facts:this.adoptions;map.set(v.recordType==='fact'?v.factId:v.requestId,{value:clone(v),durable:true,error:null,persistence:Promise.resolve(true)});}else this.recoveries.push(...group);}this.changed();return this;
 }
 prepare(entry,args){
  try{if(!json(args)||Object.keys(args).sort().join(',')!=='draftToken,stepId')throw refused();const w=this.witness(entry,args.stepId,args.draftToken),key=w.snapshot.token+':'+args.draftToken;if(this.actions.has(key))return Promise.resolve(this.actions.get(key));if(this.preparing.has(key))return this.preparing.get(key);
   const job=budget(this.custodyWaitMs),task=this.prepareCurrent(w,job).then(e=>{this.actions.set(key,e);return e;}).finally(()=>{this.preparing.delete(key);this.changed();});this.preparing.set(key,task);this.changed();return task;
  }catch(error){return Promise.reject(error);}
 }
 async retainedAction(w,job){
  const d=w.draft.value,snapshot=w.snapshot;
  // A corrupt/opaque intent original cannot establish that this action is new.
  // Keep recovery read-only rather than manufacture a replacement identity.
  for(const row of this.recoveries){if(!json(row,{live:true}))throw refused();if(typeof row.key==='string'&&['intent:','fact:','adoption:'].some(kind=>row.key.startsWith(this.prefix+kind)))throw refused();}
  const candidates=[];
  for(const entry of this.intents.values()){
   const value=entry.value;if(!json(value))throw refused();
   if(value.draftToken!==d.token||value.intent.selectionToken!==snapshot.token)continue;
   const expected=captureCookingHelpIntent({schema:1,operation:'explain-step',environment:'beta',owner:this.owner,requestId:value.requestId,cookId:snapshot.cookId,branchId:snapshot.branchId,selectionToken:snapshot.token,revision:snapshot.revision,source:{...clone(d.source),range:clone(d.range)},selectedStep:clone(d.selectedStep),question:d.question});
   if(!same(value.intent,expected))throw refused();candidates.push(entry);
  }
  if(candidates.length>1)throw refused();if(!candidates.length)return null;
  const entry=candidates[0],id=entry.value.requestId;
  if(this.ambiguous(id)||!await within(job,this.validIntent(entry.value))||!await within(job,this.physical(this.key(entry.value),entry.value)))throw refused();
  const facts=[...this.facts.values()].filter(f=>f.value.requestId===id);
  if(!facts.every(f=>this.validFact(f.value))||!(await within(job,Promise.all(facts.map(f=>this.physical(this.key(f.value),f.value))))).every(Boolean)||!w.still()||job.expired)throw refused();
  return entry;
 }
 async prepareCurrent(w,job){
  const check=()=>{if(!w.still()||job.expired)throw refused();};await within(job,Promise.all([this.sessions.entries.get(this.sessions.key(w.snapshot)).persistence,w.draft.persistence]));check();
  if(!await within(job,this.currentF(w.snapshot))||!await within(job,this.physical(this.key(w.draft.value),w.draft.value)))throw refused();check();
  const original=await this.retainedAction(w,job);check();if(original)return original;
  const d=w.draft.value,intent=captureCookingHelpIntent({schema:1,operation:'explain-step',environment:'beta',owner:this.owner,requestId:crypto.randomUUID(),cookId:w.snapshot.cookId,branchId:w.snapshot.branchId,selectionToken:w.snapshot.token,revision:w.snapshot.revision,source:{...clone(d.source),range:clone(d.range)},selectedStep:clone(d.selectedStep),question:d.question}),body=createCookingHelpRequest(intent);
  const [intentHash,bodyHash]=await within(job,Promise.all([digest(intent),digest(body)]));check();if([...this.intents.values()].filter(e=>e.value.intent.cookId===intent.cookId).length>=100)throw refused();
  const e={value:{schema:1,recordType:'intent',requestId:intent.requestId,token:intent.requestId,draftToken:d.token,intent:clone(intent),intentHash,bodyHash,at:stamp()},durable:false};this.intents.set(intent.requestId,e);this.changed();await within(job,this.write(e));check();if(!e.durable||!await within(job,this.physical(this.key(e.value),e.value)))throw refused();check();this.initialSends.add(e);return e;
 }
 ask(entry,args){
  try{if(!json(args)||Object.keys(args).sort().join(',')!=='draftToken,stepId')throw refused();const w=this.witness(entry,args.stepId,args.draftToken),key=w.snapshot.token+':'+args.draftToken;if(this.admitting.has(key))return this.admitting.get(key);const job=budget(this.custodyWaitMs);
   const task=(async()=>{const e=await within(job,this.prepare(entry,args));if(!w.still())throw refused();const previous=this.operation(e.value.requestId);if(previous.status!=='prepared')return previous;return this.oneAdmission(e.value.requestId,'create',()=>this.dispatch(e,w,job,'POST','/api/cooking-help',e.value.intent));})().finally(()=>{this.admitting.delete(key);this.changed();});this.admitting.set(key,task);this.changed();return task;
  }catch(error){return Promise.reject(error);}
 }
 async fact(e,attemptId,kind,outcome,method){
  const factId=crypto.randomUUID(),record={value:{schema:1,recordType:'fact',requestId:e.value.requestId,factId,token:factId,attemptId,kind,method,at:stamp(),intentHash:e.value.intentHash,bodyHash:e.value.bodyHash,outcome},durable:false};this.facts.set(factId,record);this.changed();await this.write(record);return record;
 }
 response(e,result){
  try{if(!json(result)||result?.requestId!==e.value.requestId||result.intentHash!==e.value.intentHash||result.bodyHash!==e.value.bodyHash||!Number.isSafeInteger(result.deadline)||result.deadline<1||!statuses.has(result.status))return false;
   if(Object.hasOwn(result,'sourceChanged')&&typeof result.sourceChanged!=='boolean'||Object.hasOwn(result,'cancelled')&&typeof result.cancelled!=='boolean'||Object.hasOwn(result,'late')&&typeof result.late!=='boolean')return false;
   if(result.status==='completed'||result.status==='late-result'){validateCookingHelpResult(result.result,e.value.intent);if(typeof result.sourceChanged!=='boolean'||typeof result.cancelled!=='boolean'||result.late!==(result.status==='late-result'))return false;}
   return true;
  }catch{return false;}
 }
 operation(id){
  const e=this.intents.get(id);if(!e)return null;const facts=[...this.facts.values()].filter(f=>f.value.requestId===id),responses=facts.filter(f=>f.value.kind==='response'),valid=responses.filter(f=>this.response(e,f.value.outcome?.result));let status=this.initialSends.has(e)?'prepared':'unknown',receipt=null,deadline=null;
  if(this.ambiguous(id)||facts.some(f=>!this.validFact(f.value))||responses.some(f=>!this.response(e,f.value.outcome?.result))||valid.some(f=>f.value.outcome.result.deadline!==valid[0].value.outcome.result.deadline))status='review';
  else if(valid.length){receipt=valid.at(-1).value.outcome.result;deadline=receipt.deadline;const results=valid.filter(f=>Object.hasOwn(f.value.outcome.result,'result'));status=results.some(f=>!same(f.value.outcome.result.result,results[0].value.outcome.result.result))?'review':responses.some(f=>!f.durable)?'receipt-unretained':receipt.status;}
  else if(facts.some(f=>f.value.method==='POST'&&f.value.kind==='error'&&Number.isInteger(f.value.outcome.status)&&f.value.outcome.status!==404))status='refused';
  else if(facts.some(f=>['unknown','error','attempt'].includes(f.value.kind)))status=this.live.has(id)&&!facts.some(f=>f.value.kind==='unknown'||f.value.kind==='error')?'waiting':'unknown';
  const cancelRequested=facts.some(f=>f.value.kind==='cancel-observation'&&f.value.outcome?.result?.requestId===id&&f.value.outcome.result.cancelled===true);
  return{intent:clone(e.value.intent),intentHash:e.value.intentHash,bodyHash:e.value.bodyHash,status,deadline,receipt:receipt?clone(receipt):null,cancelRequested,requestPending:this.live.has(id),durable:e.durable&&facts.every(f=>f.durable)};
 }
 oneAdmission(id,kind,work){const key='request:'+id,previous=this.admitting.get(key);if(previous)return previous.kind===kind?previous:Promise.reject(refused());const task=Promise.resolve().then(work).finally(()=>{this.admitting.delete(key);this.changed();});task.kind=kind;this.admitting.set(key,task);this.changed();return task;}
 async dispatch(e,w,job,method,path,body){
  if(this.live.has(e.value.requestId))return this.operation(e.value.requestId);
  if(!await within(job,this.validIntent(e.value))||!await within(job,this.physical(this.key(e.value),e.value))||!await within(job,this.currentF(w.snapshot))||!await within(job,this.physical(this.key(w.draft.value),w.draft.value))||!w.still())throw refused();
  const originals=[...this.facts.values()].filter(f=>f.value.requestId===e.value.requestId);if(this.ambiguous(e.value.requestId)||originals.some(f=>!this.validFact(f.value))||!(await within(job,Promise.all(originals.map(f=>this.physical(this.key(f.value),f.value))))).every(Boolean)||!w.still()||!['prepared','unknown'].includes(this.operation(e.value.requestId).status))throw refused();
  // Initial-send authority exists only in the preparing instance and is used
  // once. Missing recovered facts cannot establish that no POST ever happened.
  if(method==='POST')this.initialSends.delete(e);
  const attemptId=crypto.randomUUID(),attempt=await within(job,this.fact(e,attemptId,'attempt',{},method));if(!attempt.durable||!await within(job,this.physical(this.key(attempt.value),attempt.value))||!w.still())throw refused();
  // The last witness and invocation share one synchronous boundary. No deferred
  // callback may acquire authority from a replacement view.
  let request;try{if(job.expired||performance.now()>=job.deadline||!w.still())throw refused();request=this.request(path,{method,...(body?{body:clone(body)}:{}),refreshToday:false});}catch(error){request=Promise.reject(error);}
  return this.keepExchange(e,attemptId,method,request);
 }
 keepExchange(e,attemptId,method,request){
  let settle;const cutoff=new Promise(resolve=>settle=resolve),id=e.value.requestId,timer=setTimeout(()=>{void this.fact(e,attemptId,'unknown',{observationOnly:true,reason:'The original request may still finish.'},method);settle();},this.observationMs);
  const exchange=Promise.resolve(request).then(result=>this.fact(e,attemptId,method==='CANCEL'?'cancel-observation':'response',{result},method),error=>this.fact(e,attemptId,'error',errorOutcome(error),method)).catch(()=>{}).finally(()=>{clearTimeout(timer);if(this.live.get(id)===exchange)this.live.delete(id);settle();this.changed();});
  this.live.set(id,exchange);this.observers.add(cutoff);this.changed();cutoff.finally(()=>{this.observers.delete(cutoff);this.changed();});return cutoff.then(()=>this.operation(id));
 }
 retryExact(id){
  try{const e=this.intents.get(id),state=this.operation(id);if(!e||state.status!=='unknown'||!state.durable||state.cancelRequested||this.live.has(id))throw refused();const scope=this.getScope(),w=this.witness(scope.entry,e.value.intent.selectedStep.id,e.value.draftToken,{historical:e.value.intent});return this.oneAdmission(id,'retry',()=>this.dispatch(e,w,budget(this.custodyWaitMs),'POST','/api/cooking-help',e.value.intent));}catch(error){return Promise.reject(error);}
 }
 observe(id){return this.observeNamed(id,false);}
 cancel(id){return this.observeNamed(id,true);}
 observeNamed(id,cancel){
  try{const e=this.intents.get(id),scope=this.getScope();if(!e||this.disposed||scope?.owner!==this.owner||scope?.environment!=='beta'||!scope.viewLease||this.live.has(id))throw refused();const lease=scope.viewLease,routeHash=scope.routeHash,job=budget(this.custodyWaitMs);
   const still=()=>{const now=this.getScope();return !this.disposed&&!this.sessions.disposed&&now?.viewLease===lease&&now.owner===this.owner&&now.environment==='beta'&&now.routeHash===routeHash;};
   return this.oneAdmission(id,cancel?'cancel':'observe',async()=>{if(!await within(job,this.validIntent(e.value))||!await within(job,this.physical(this.key(e.value),e.value))||!still())throw refused();const attemptId=crypto.randomUUID(),method=cancel?'CANCEL':'GET',attempt=await within(job,this.fact(e,attemptId,'attempt',{},method));if(!attempt.durable||!await within(job,this.physical(this.key(attempt.value),attempt.value))||!still())throw refused();let request;try{if(job.expired||performance.now()>=job.deadline||!still())throw refused();request=this.request('/api/cooking-help/'+id+(cancel?'/cancel':''),{method:cancel?'POST':'GET',...(cancel?{body:{}}:{}),refreshToday:false});}catch(error){request=Promise.reject(error);}return this.keepExchange(e,attemptId,method,request);});
  }catch(error){return Promise.reject(error);}
 }
 adopt(id,entry){
  if(this.adopting.has(id))return this.adopting.get(id);const task=this.adoptCurrent(id,entry).finally(()=>{this.adopting.delete(id);this.changed();});this.adopting.set(id,task);this.changed();return task;
 }
 async adoptCurrent(id,entry){
  const e=this.intents.get(id),state=this.operation(id),scope=this.getScope(),job=budget(this.custodyWaitMs);if(!e||state.status!=='completed'||state.cancelRequested||state.receipt?.sourceChanged||state.receipt?.cancelled||state.receipt?.late||!state.receipt.result.suggestedStepText)throw refused();
  const intent=e.value.intent,existing=this.adoptions.get(id),selected=entry?.value.steps?.find(s=>s.id===intent.selectedStep.id);
  this.sessions.assertEntry(entry);if(!json(entry.value)||scope?.owner!==this.owner||scope.environment!=='beta'||scope.entry!==entry||scope.stepId!==intent.selectedStep.id||scope.rawUnsaved!==false||!scope.viewLease||scope.routeHash!==route(intent.cookId)||entry.value.cookId!==intent.cookId||entry.value.source.id!==intent.source.id||entry.value.source.version!==intent.source.version||entry.value.source.data.recipe!==intent.source.recipe||selected?.text!==intent.selectedStep.text)throw refused();
  // An existing predetermined step is recovery, not another application. It may
  // belong to the normal direct edit fork, but never to an unrelated branch.
  if(existing){const snapshot=clone(entry.value),lease=scope.viewLease;
   if(!this.validAdoption(existing.value)||!await within(job,this.validIntent(e.value))||!await within(job,this.physical(this.key(e.value),e.value))||!await within(job,this.physical(this.key(existing.value),existing.value)))throw refused();
   const facts=[...this.facts.values()].filter(f=>f.value.requestId===id);if(!facts.every(f=>this.validFact(f.value))||!(await within(job,Promise.all(facts.map(f=>this.physical(this.key(f.value),f.value))))).every(Boolean))throw refused();
   const latest=this.operation(id);if(latest.status!=='completed'||latest.cancelRequested||latest.requestPending||!same(latest.receipt,state.receipt))throw refused();const now=this.getScope();if(this.disposed||now?.owner!==this.owner||now.environment!=='beta'||now.entry!==entry||now.viewLease!==lease||now.rawUnsaved!==false||now.stepId!==intent.selectedStep.id||now.routeHash!==route(intent.cookId)||!same(entry.value,snapshot))throw refused();if(entry.value.branchId!==existing.value.branchId&&entry.value.parentBranchId!==existing.value.branchId)throw refused();const targets=[];for(const target of this.sessions.entries.values()){
    const value=target.value;if(!json(value)||value.cookId!==intent.cookId||value.branchId!==existing.value.branchId&&value.parentBranchId!==existing.value.branchId||!same(value.source,entry.value.source))continue;
    const steps=value.steps.filter(s=>s.id===existing.value.stepId);if(steps.length>1)throw refused();if(steps.length===1)targets.push({entry:target,step:steps[0]});
   }
   // The original parent may still be selected, or have been remounted after the
   // deliberate edit fork was saved. Recover the real target before beginEdit;
   // neither a cached fork nor a fresh manager may append this UUID again.
   if(targets.length>1)throw refused();if(targets.length===1){
    const target=targets[0];this.sessions.assertEntry(target.entry);
    const targetSnapshot=clone(target.entry.value),selectedSaved=entry.durable===true,targetSaved=target.entry.durable===true,persistence=target.entry.persistence,epoch=this.sessions.epoch;
    // A genuinely dirty/held original keeps its existing persistence handle.
    // A settled saved-looking copy must freshly prove its complete physical F.
    if(selectedSaved&&!await within(job,this.currentF(snapshot)))throw refused();
    if(target.entry!==entry&&targetSaved&&!await within(job,this.currentF(targetSnapshot)))throw refused();
    const current=this.getScope(),final=this.operation(id);
    if(this.disposed||this.sessions.disposed||job.expired||performance.now()>=job.deadline||current?.owner!==this.owner||current.environment!=='beta'||current.entry!==entry||current.viewLease!==lease||current.rawUnsaved!==false||current.stepId!==intent.selectedStep.id||current.routeHash!==route(intent.cookId)||!same(entry.value,snapshot)||!same(target.entry.value,targetSnapshot)||entry.durable!==selectedSaved||target.entry.durable!==targetSaved||target.entry.persistence!==persistence||this.sessions.epoch!==epoch||final.status!=='completed'||final.cancelRequested||final.requestPending||!same(final.receipt,state.receipt))throw refused();
    this.sessions.assertEntry(target.entry);return{entry:target.entry,step:clone(target.step),persistence};
   }
  }
  if(entry.value.branchId!==intent.branchId||entry.value.steps.length>=80)throw refused();
  const w=this.witness(entry,intent.selectedStep.id,this.draft(entry,intent.selectedStep.id)?.value.token,{historical:intent});
  await within(job,entry.persistence);if(!w.still()||!await within(job,this.currentF(w.snapshot))||!await within(job,this.validIntent(e.value))||!await within(job,this.physical(this.key(e.value),e.value)))throw refused();
  const facts=[...this.facts.values()].filter(f=>f.value.requestId===id);if(!(await within(job,Promise.all(facts.map(f=>this.physical(this.key(f.value),f.value))))).every(Boolean)||!w.still()||this.operation(id).status!=='completed')throw refused();validateCookingHelpResult(state.receipt.result,intent);
  const adoption=existing??{value:{schema:1,recordType:'adoption',requestId:id,token:crypto.randomUUID(),stepId:crypto.randomUUID(),cookId:intent.cookId,branchId:intent.branchId,intentHash:e.value.intentHash,bodyHash:e.value.bodyHash,at:stamp()},durable:false};if(!existing){this.adoptions.set(id,adoption);this.changed();await within(job,this.write(adoption));}
  if(!adoption.durable||!await within(job,this.physical(this.key(adoption.value),adoption.value))||!w.still()||job.expired||performance.now()>=job.deadline)throw refused();const latest=this.operation(id);if(latest.status!=='completed'||latest.cancelRequested||latest.requestPending||!same(latest.receipt,state.receipt))throw refused();
  const step={id:adoption.value.stepId,text:state.receipt.result.suggestedStepText,reviewed:false,done:false,minutes:null},target=this.sessions.beginEdit(entry);const persistence=this.sessions.edit(target,{steps:[...clone(target.value.steps),step]});return{entry:target,step:clone(step),persistence};
 }
 async retryLocal(){for(const map of [this.drafts,this.intents,this.facts,this.adoptions])for(const entry of map.values())if(!await this.physical(this.key(entry.value),entry.value))await this.write(entry);this.changed();}
 async settledLocal(){for(;;){await Promise.allSettled([...this.writes]);if(!this.writes.size)return;}}
 async settledExchanges(){for(;;){await Promise.allSettled([...this.live.values()]);await this.settledLocal();if(!this.live.size)return;}}
 recoveryWitness(row){
  // Local raw bytes and the complete IndexedDB envelope are the originals. A
  // parsed schema failure must not make them disappear from the leave proof.
  try{if(!row||Object.getPrototypeOf(row)!==Object.prototype)return null;const ds=Object.getOwnPropertyDescriptors(row);
   if(Reflect.ownKeys(ds).some(k=>typeof k!=='string'||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))return null;
   const backend=ds.backend?.value,key=ds.key?.value;if(typeof key!=='string'||!key.startsWith(this.prefix))return null;
   const witness=backend==='localStorage'&&typeof ds.raw?.value==='string'?{backend,key,raw:ds.raw.value}:backend==='indexedDB'&&json(ds.envelope?.value)?{backend,key,envelope:clone(ds.envelope.value)}:null;
   return witness&&json(witness)?witness:null;
  }catch{return null;}
 }
 recoveryStamp(){const values=[this.recoveries,this.recoveries.length];for(const row of this.recoveries){const witness=this.recoveryWitness(row);values.push(row,witness?JSON.stringify(witness):null);}return values;}
 async recoveryRetained(witness){
  if(!witness)return false;const rows=await this.store.inspectPhysical(witness.key);return rows.some(row=>same(this.recoveryWitness(row),witness));
 }
 async checkCustody(job){
  for(;;){if(this.getScope()?.owner!==this.owner||this.getScope()?.environment!=='beta')return false;await Promise.allSettled([...this.preparing.values(),...this.admitting.values(),...this.adopting.values(),...this.observers]);if(job.expired)return false;await this.settledLocal();if(job.expired)return false;const epoch=this.epoch,recoveryStamp=this.recoveryStamp(),recoveries=this.recoveries.map(row=>this.recoveryWitness(row)),entries=[...this.drafts.values(),...this.intents.values(),...this.facts.values(),...this.adoptions.values()];const retained=await Promise.all([...entries.map(e=>this.physical(this.key(e.value),e.value)),...recoveries.map(witness=>this.recoveryRetained(witness))]);if(job.expired||this.getScope()?.owner!==this.owner||this.getScope()?.environment!=='beta')return false;if(epoch!==this.epoch||this.writes.size||this.preparing.size||this.admitting.size||this.adopting.size||this.observers.size||!sameStamp(recoveryStamp,this.recoveryStamp()))continue;return retained.every(Boolean);}
 }
 exportRecovery(){return{drafts:[...this.drafts.values()].map(e=>clone(e.value)),intents:[...this.intents.values()].map(e=>clone(e.value)),facts:[...this.facts.values()].map(e=>json(e.value,{live:true})?clone(e.value):e.value),adoptions:[...this.adoptions.values()].map(e=>clone(e.value)),recoveries:this.recoveries};}
 destroy(){this.disposed=true;this.changed();}
}
