const clone=value=>structuredClone(value),stamp=()=>new Date().toISOString();
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const owner=value=>typeof value==='string'?value.trim().toLowerCase():'';
function json(value,limit=131072){
 const pending=[{value,depth:0}],ancestors=new Set();let nodes=0;
 try{while(pending.length){const p=pending.pop(),v=p.value;if(p.exit){ancestors.delete(v);continue;}if(++nodes>25000||p.depth>64)return false;
  if(v===null||typeof v==='string'||typeof v==='boolean')continue;if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))return false;continue;}
  if(typeof v!=='object'||ancestors.has(v)||!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype)return false;
  const keys=Reflect.ownKeys(v);if(Array.isArray(v)&&(keys.length!==v.length+1||keys.at(-1)!=='length'))return false;ancestors.add(v);pending.push({value:v,exit:true});
  for(const k of keys){if(Array.isArray(v)&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!d?.enumerable||!Object.hasOwn(d,'value'))return false;pending.push({value:d.value,depth:p.depth+1});}
 }return new TextEncoder().encode(JSON.stringify(value)).length<=limit;}catch{return false;}
}
function same(a,b){if(!json(a,4000000)||!json(b,4000000))return false;const pending=[[a,b]];while(pending.length){const [x,y]=pending.pop();if(Object.is(x,y))continue;if(x===null||y===null||typeof x!=='object'||typeof y!=='object'||Array.isArray(x)!==Array.isArray(y)||Object.keys(x).length!==Object.keys(y).length)return false;for(const k of Object.keys(x)){if(!Object.hasOwn(y,k))return false;pending.push([x[k],y[k]]);}}return true;}
async function digest(value){if(!json(value,4000000))throw Error('Keep the original value for review; it cannot be represented exactly.');return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const dated=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const route=cookId=>'#reminders?view=cooking&session='+cookId;
function receipt(intent,result){
 if(!json(result)||result?.pending!==undefined||result?.nextOccurrenceId!==null||!uuid(result?.auditId))return false;
 const item=result.item,expected={...intent.request.body.data,dueAt:null,nextOccurrenceId:null,completedAt:null};
 return item?.kind==='reminder'&&item.id===intent.request.body.id&&item.version===1&&item.auditId===result.auditId&&dated(item.createdAt)&&item.createdAt===item.updatedAt&&same(item.data,expected);
}

// A separate manual journal: none of these records enter the generic automatic outbox.
export class CookingGroceries{
 constructor({sessions,request,getScope,observationMs=30000,custodyWaitMs=2000,onChange=()=>{}}){
  if(!sessions?.prefix?.startsWith('local-cooking:v1:beta:')||typeof request!=='function'||typeof getScope!=='function'||!Number.isFinite(observationMs)||observationMs<1||observationMs>30000||!Number.isFinite(custodyWaitMs)||custodyWaitMs<1||custodyWaitMs>2000)throw Error('A signed-in beta cooking workspace is required.');
  this.sessions=sessions;this.store=sessions.store;this.request=request;this.getScope=getScope;this.observationMs=observationMs;this.custodyWaitMs=custodyWaitMs;this.onChange=onChange;this.prefix=sessions.prefix.replace('local-cooking:','local-cooking-grocery:');this.owner=decodeURIComponent(sessions.prefix.slice('local-cooking:v1:beta:'.length,-1));
  this.intents=new Map();this.facts=new Map();this.cohorts=new Map();this.recoveries=[];this.writes=new Set();this.preparing=new Map();this.sending=new Map();this.admitting=new Map();this.live=new Map();this.observers=new Set();this.epoch=0;this.disposed=false;
 }
 intentKey(id){return this.prefix+'intent:'+id;}
 factKey(value){return this.prefix+'fact:'+value.operationId+':'+value.factId;}
 cohortKey(id){return this.prefix+'cohort:'+id;}
 changed(){this.epoch++;if(!this.disposed)this.onChange();}
 async physical(key,value){return json(value)&&typeof this.store.isDurable==='function'&&typeof this.store.inspectPhysical==='function'&&await this.store.isDurable(key,value.token)===true&&(await this.store.inspectPhysical(key)).some(row=>row.key===key&&!row.parseError&&!row.keyMismatch&&same(row.value,value));}
 write(key,entry){
  const task=(async()=>{entry.durable=false;try{if(!json(entry.value))return false;const originals=(await this.store.inspectPhysical(key)).filter(row=>row.key===key);if(originals.some(row=>row.parseError||row.keyMismatch||!same(row.value,entry.value)))return false;entry.durable=await this.store.put(key,entry.value)===true&&await this.physical(key,entry.value);return entry.durable;}catch{return false;}finally{this.changed();}})();this.writes.add(task);this.changed();task.finally(()=>this.writes.delete(task));return task;
 }
 allowed(intent,entry){const s=this.getScope();return !this.disposed&&!this.sessions.disposed&&s?.environment==='beta'&&owner(s.owner)===this.owner&&s.routeHash===route(intent.cook.cookId)&&(entry?s.entry===entry&&entry.value.token===intent.sessionToken:s.recoveryId===intent.operationId||s.entry?.value.cookId===intent.cook.cookId&&s.entry?.value.branchId===intent.cook.branchId);}
 async validIntent(v){
  if(!json(v)||v?.schema!==1||v.recordType!=='intent'||!uuid(v.operationId)||v.token!==v.operationId||!uuid(v.cook?.cookId)||!uuid(v.cook?.branchId)||v.cook.sessionKey!==this.sessions.prefix+v.cook.cookId+':'+v.cook.branchId||!uuid(v.sessionToken)||!dated(v.approvedAt)||!hex(v.source?.sha256)||v.source.kind!=='meal'||!hex(v.requestSha256)||!uuid(v.ingredient?.id)||v.ingredient.need!==true)return false;
  const r=v.request,b=r?.body,d=b?.data,dest=v.destination;
  return r?.path==='/api/actions/reminder-save'&&r.method==='POST'&&uuid(b?.mutationId)&&uuid(b?.id)&&b.version===0&&b.id!==b.mutationId&&same(b.groceryGuard,{listVersion:dest?.version,type:'grocery'})&&typeof dest?.id==='string'&&/^[\w-]{1,100}$/.test(dest.id)&&Number.isSafeInteger(dest.version)&&dest.version>0&&dest.type==='grocery'&&typeof dest.title==='string'&&d?.listId===dest.id&&d.title===v.ingredient.text&&typeof d.title==='string'&&!!d.title.trim()&&d.title.length<=300&&typeof d.notes==='string'&&d.notes.length<=10000&&typeof d.section==='string'&&d.section.length<=100&&Number.isFinite(d.order)&&Math.abs(d.order)<=100000&&same(d,{listId:dest.id,title:v.ingredient.text,notes:d.notes,section:d.section,order:d.order,completed:false,archived:false,flagged:false,priority:0,tags:[],subtasks:[],dueDate:'',dueTime:'',recurrence:{unit:'none',interval:1}})&&await digest(r)===v.requestSha256;
 }
 async sourceRetained(intent){
  const rows=await this.store.inspectPhysical(intent.cook.sessionKey);
  for(const row of rows)if(row.key===intent.cook.sessionKey&&!row.parseError&&!row.keyMismatch&&json(row.value,4000000)&&row.value.cookId===intent.cook.cookId&&row.value.branchId===intent.cook.branchId&&row.value.source?.kind===intent.source.kind&&row.value.source.id===intent.source.id&&row.value.source.version===intent.source.version&&await digest(row.value.source)===intent.source.sha256&&await this.sessions.physicallyRetained(row.value))return true;
  return false;
 }
 async initialize(){
  const rows=await this.store.inspectPhysical(this.prefix),groups=new Map();for(const row of rows){const group=groups.get(row.key)||[];group.push(row);groups.set(row.key,group);}
  const later=[];for(const [key,group]of groups){const v=group[0].value;if(group.some(row=>row.parseError||row.keyMismatch||!same(row.value,v))||!json(v)||v===null||typeof v!=='object'||Array.isArray(v)){this.recoveries.push(...group);continue;}
   if(key===this.intentKey(v.operationId)&&await this.validIntent(v)&&await this.physical(key,v))this.intents.set(v.operationId,{value:clone(v),durable:true});else later.push({key,group,v});
  }
  for(const {key,group,v}of later){const intent=this.intents.get(v.operationId)?.value;
   if(v.schema===1&&v.recordType==='fact'&&uuid(v.factId)&&v.token===v.factId&&uuid(v.attemptId)&&dated(v.at)&&intent&&v.requestSha256===intent.requestSha256&&['attempt','canceled-before-send','unknown','conflict','refused','receipt'].includes(v.kind)&&key===this.factKey(v)&&await this.physical(key,v)&&(v.kind!=='receipt'||receipt(intent,v.outcome?.result)))this.facts.set(v.factId,{value:clone(v),durable:true});
   else if(v.schema===1&&v.recordType==='cohort'&&uuid(v.cohortId)&&v.token===v.cohortId&&Array.isArray(v.operationIds)&&v.operationIds.length>0&&v.operationIds.length<=100&&new Set(v.operationIds).size===v.operationIds.length&&v.operationIds.every(id=>this.intents.has(id))&&key===this.cohortKey(v.cohortId)&&await this.physical(key,v))this.cohorts.set(v.cohortId,{value:clone(v),durable:true});
   else this.recoveries.push(...group);
  }this.changed();return this;
 }
 operation(id){
  const entry=this.intents.get(id);if(!entry)return null;const facts=[...this.facts.values()].filter(f=>f.value.operationId===id),receipts=facts.filter(f=>f.value.kind==='receipt'&&receipt(entry.value,f.value.outcome?.result)),attempts=new Map(),uncertain=new Set(),retainedTerminal=new Map();let status='prepared',actual;
  for(const f of facts){const id=f.value.attemptId,kinds=attempts.get(id)??new Set();kinds.add(f.value.kind);attempts.set(id,kinds);
   if(f.value.kind==='unknown'&&f.value.outcome?.observationOnly!==true)uncertain.add(id);
   if(f.durable&&['conflict','refused'].includes(f.value.kind)){const terminal=retainedTerminal.get(id)??new Set();terminal.add(f.value.kind);retainedTerminal.set(id,terminal);}
  }
  const contradictory=[...attempts.values()].some(kinds=>kinds.has('canceled-before-send')&&['unknown','conflict','refused','receipt'].some(kind=>kinds.has(kind))||kinds.has('receipt')&&(kinds.has('conflict')||kinds.has('refused'))||kinds.has('conflict')&&kinds.has('refused'));
  if(receipts.length){actual=receipts[0].value.outcome.result;status=contradictory||receipts.some(f=>!same(f.value.outcome.result,actual))?'review':receipts.some(f=>f.durable)?'confirmed':'receipt-unretained';}
  else if(contradictory)status='review';
  else{const states=[...attempts].map(([id,kinds])=>{
   // Only a saved terminal result for this same attempt can resolve an observer cutoff.
   // A lost/malformed response or another attempt's uncertainty remains unresolved.
   if(kinds.has('unknown')&&(uncertain.has(id)||!retainedTerminal.has(id)))return 'unknown';
   return kinds.has('conflict')?'conflict':kinds.has('refused')?'refused':kinds.has('canceled-before-send')?'prepared':'attempt';
  });if(states.some(x=>x==='unknown'||x==='attempt'))status=this.live.has(id)&&!states.includes('unknown')?'waiting':'unknown';else if(states.includes('conflict'))status='conflict';else if(states.includes('refused'))status='refused';}
  return{intent:clone(entry.value),status,receipt:actual?clone(actual):null,requestPending:this.live.has(id)||this.admitting.has(id)};
 }
 prepare(entry,ingredientIds,list,reviewed={}){
  try{this.sessions.assertEntry(entry);if(!json(ingredientIds)||!json(list)||!json(reviewed))throw Error('Keep the original grocery review; this value cannot be saved exactly.');const key=entry.value.token+':'+JSON.stringify([ingredientIds,list,reviewed]);if(this.preparing.has(key))return this.preparing.get(key);
   const task=this.prepareCurrent(entry,clone(ingredientIds),clone(list),clone(reviewed)).finally(()=>this.preparing.delete(key));this.preparing.set(key,task);return task;
  }catch(error){return Promise.reject(error);}
 }
 viewWitness(scope=this.getScope()){
  const entry=scope?.entry,token=entry?.value.token,viewLease=scope?.viewLease,reviewEpoch=scope?.groceryReviewEpoch,
   environment=scope?.environment,scopeOwner=scope?.owner,routeHash=scope?.routeHash,recoveryId=scope?.recoveryId;
  return()=>{const current=this.getScope();return !this.disposed&&current?.environment===environment&&current?.owner===scopeOwner
   &&current?.routeHash===routeHash&&current?.entry===entry&&(!entry||entry.value.token===token)
   &&current?.viewLease===viewLease&&current?.groceryReviewEpoch===reviewEpoch&&current?.recoveryId===recoveryId;};
 }
 async prepareCurrent(entry,ids,list,reviewed){
  const currentView=this.viewWitness(),snapshot=clone(entry.value);if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||list.kind!=='reminder-list'||!Number.isSafeInteger(list.version)||list.version<1||list.data?.type!=='grocery'||list.data.archived!==false||typeof list.data.title!=='string')throw Error('Review the selected ingredients and an active grocery list.');
  await entry.persistence;if(!await this.sessions.physicallyRetained(snapshot)||entry.value.token!==snapshot.token||!currentView())throw Error('The cooking view or review changed. Save the exact current review on this device first.');
  if([...this.intents.values()].filter(x=>x.value.cook.cookId===snapshot.cookId).length+ids.length>100)throw Error('This cooking session retains up to 100 grocery additions. Keep the originals for review.');
  const source={kind:snapshot.source.kind,id:snapshot.source.id,version:snapshot.source.version,sha256:await digest(snapshot.source)},prepared=[];
  for(const id of ids){const ingredient=snapshot.ingredients.find(x=>x.id===id);if(!ingredient?.need||!ingredient.text.trim())throw Error('Review each selected ingredient before adding it.');const operationId=crypto.randomUUID(),data={listId:list.id,title:ingredient.text,notes:reviewed.notes??'',section:reviewed.section??'',order:reviewed.order??0,completed:false,archived:false,flagged:false,priority:0,tags:[],subtasks:[],dueDate:'',dueTime:'',recurrence:{unit:'none',interval:1}},request={path:'/api/actions/reminder-save',method:'POST',body:{mutationId:crypto.randomUUID(),id:crypto.randomUUID(),version:0,groceryGuard:{listVersion:list.version,type:'grocery'},data}};
   const value={schema:1,recordType:'intent',operationId,token:operationId,cook:{cookId:snapshot.cookId,branchId:snapshot.branchId,sessionKey:this.sessions.key(snapshot)},sessionToken:snapshot.token,source:clone(source),ingredient:clone(ingredient),destination:{id:list.id,version:list.version,type:'grocery',title:list.data.title},approvedAt:stamp(),request,requestSha256:await digest(request)};
   if(!await this.validIntent(value)||!currentView()||!this.allowed(value,entry)||entry.value.token!==snapshot.token)throw Error('The cooking review changed or cannot be saved exactly. Review it before adding.');prepared.push({value,durable:false});
  }
  if(!currentView())throw Error('The cooking view or review changed before the selection was saved.');
  // Recheck at the synchronous insertion boundary after digest/validation waits.
  // Distinct concurrent preparations cannot both spend the same remaining capacity.
  if([...this.intents.values()].filter(x=>x.value.cook.cookId===snapshot.cookId).length+prepared.length>100)throw Error('This cooking session retains up to 100 grocery additions. Keep the originals for review.');
  const cohortId=crypto.randomUUID(),cohort={value:{schema:1,recordType:'cohort',cohortId,token:cohortId,operationIds:prepared.map(x=>x.value.operationId),approvedAt:stamp()},durable:false};for(const item of prepared)this.intents.set(item.value.operationId,item);this.cohorts.set(cohortId,cohort);
  for(const item of prepared)await this.write(this.intentKey(item.value.operationId),item);await this.write(this.cohortKey(cohortId),cohort);cohort.durable=cohort.durable&&(await Promise.all(prepared.map(x=>this.physical(this.intentKey(x.value.operationId),x.value)))).every(Boolean);
  this.changed();return{...clone(cohort.value),durable:cohort.durable};
 }
 sendPrepared(cohort){
  const saved=this.cohorts.get(cohort?.cohortId);if(!saved||!same(saved.value,{schema:cohort.schema,recordType:cohort.recordType,cohortId:cohort.cohortId,token:cohort.token,operationIds:cohort.operationIds,approvedAt:cohort.approvedAt}))return Promise.reject(Error('Review the saved grocery selection.'));
  if(this.sending.has(cohort.cohortId))return this.sending.get(cohort.cohortId);
  const currentView=this.viewWitness();
  const task=(async()=>{if(!saved.durable||!await this.physical(this.cohortKey(cohort.cohortId),saved.value)||!(await Promise.all(cohort.operationIds.map(id=>this.physical(this.intentKey(id),this.intents.get(id)?.value)))).every(Boolean))throw Error('Save every reviewed grocery addition on the device before sending.');let confirmed=0;
   for(const id of cohort.operationIds){if(!currentView())break;const current=await this.verifiedOperation(id);if(!currentView())break;if(current?.status==='confirmed'){confirmed++;continue;}if(current?.status!=='prepared')break;await this.dispatch(id);if(this.operation(id)?.status!=='confirmed')break;confirmed++;}return{confirmed,total:cohort.operationIds.length};
  })().finally(()=>this.sending.delete(cohort.cohortId));this.sending.set(cohort.cohortId,task);return task;
 }
 async fact(intent,attemptId,kind,outcome){const factId=crypto.randomUUID(),entry={value:{schema:1,recordType:'fact',operationId:intent.operationId,factId,token:factId,attemptId,kind,at:stamp(),requestSha256:intent.requestSha256,outcome},durable:false};this.facts.set(factId,entry);await this.write(this.factKey(entry.value),entry);return entry;}
 async verifiedOperation(id){for(const saved of this.facts.values())if(saved.value.operationId===id&&saved.value.kind==='receipt'){const durable=await this.physical(this.factKey(saved.value),saved.value);if(durable!==saved.durable){saved.durable=durable;this.changed();}}return this.operation(id);}
 async cohortRetained(id){
  const approved=[...this.cohorts.values()].filter(entry=>entry.value.operationIds.includes(id));if(approved.length!==1)return false;const cohort=approved[0];
  if(!cohort.durable||!await this.physical(this.cohortKey(cohort.value.cohortId),cohort.value))return false;
  for(const operationId of cohort.value.operationIds){const item=this.intents.get(operationId);if(!item?.durable||!await this.validIntent(item.value)||!await this.physical(this.intentKey(operationId),item.value))return false;}return true;
 }
 dispatch(id){if(this.admitting.has(id))return this.admitting.get(id);const task=this.dispatchCurrent(id).finally(()=>this.admitting.delete(id));this.admitting.set(id,task);return task;}
 async dispatchCurrent(id){
  const scope=this.getScope(),currentView=this.viewWitness(scope),entryAtStart=scope?.entry,token=entryAtStart?.value.token;
  const entry=this.intents.get(id),intent=entry?.value;if(!intent||!await this.validIntent(intent)||!entry.durable||!await this.physical(this.intentKey(id),intent)||!await this.sourceRetained(intent))throw Error('Review the original saved grocery addition and recipe before retrying.');
  if(!await this.cohortRetained(id))throw Error('Save every reviewed grocery addition and its original selection on the device before sending.');
  let state=await this.verifiedOperation(id);if(state.status==='confirmed')return state;
  if(['receipt-unretained','review'].includes(state.status))throw Error('Keep the actual received receipt and retry its device save. Do not send another grocery addition.');
  if(this.live.has(id))return state;
  if([...this.facts.values()].filter(f=>f.value.operationId===id).length>7)throw Error('Keep these original attempts for review. This addition has reached its recovery limit.');
  const still=()=>currentView()&&this.allowed(intent)&&this.getScope()?.entry===entryAtStart&&(!entryAtStart||entryAtStart.value.token===token);
  if(!still())throw Error('Open and review the original cooking addition before sending.');const attemptId=crypto.randomUUID(),attempt=await this.fact(intent,attemptId,'attempt',{});if(!attempt.durable||!await this.physical(this.factKey(attempt.value),attempt.value))throw Error('Save this exact grocery attempt on the device first.');
  let settle,invoked=false;const cutoff=new Promise(resolve=>settle=resolve),timeout=setTimeout(()=>{if(invoked)void this.fact(intent,attemptId,'unknown',{observationOnly:true,reason:'No full retained receipt arrived within the observation period. The original request may still finish.'}).catch(()=>{});settle();},this.observationMs);
  const canceled=Symbol('canceled-before-send');
  const exchange=Promise.resolve().then(async()=>{if(!still()){await this.fact(intent,attemptId,'canceled-before-send',{reason:'The initiating cooking review changed before the deferred request was invoked.'});return canceled;}invoked=true;return this.request(intent.request.path,{method:intent.request.method,body:clone(intent.request.body)});}).then(async result=>{if(result!==canceled)await this.fact(intent,attemptId,receipt(intent,result)?'receipt':'unknown',{result});},async error=>{await this.fact(intent,attemptId,error.status===409?'conflict':error.status===400?'refused':'unknown',{message:String(error.message||error),...(Number.isInteger(error.status)?{status:error.status}:{}),...(typeof error.code==='string'?{code:error.code}:{}),...(json(error.current)?{current:clone(error.current)}:{})});}).catch(()=>{}).finally(()=>{clearTimeout(timeout);if(this.live.get(id)===exchange)this.live.delete(id);settle();this.changed();});
  this.live.set(id,exchange);this.observers.add(cutoff);cutoff.finally(()=>this.observers.delete(cutoff));await cutoff;return this.operation(id);
 }
 retryExact(id){if(!this.intents.has(id))return Promise.reject(Error('The saved addition needs review.'));return this.dispatch(id);}
 async retryLocal(){for(const [id,e]of this.intents)if(!e.durable||!await this.physical(this.intentKey(id),e.value))await this.write(this.intentKey(id),e);for(const [id,e]of this.cohorts)if(!e.durable||!await this.physical(this.cohortKey(id),e.value))await this.write(this.cohortKey(id),e);for(const e of this.facts.values())if(!e.durable||!await this.physical(this.factKey(e.value),e.value))await this.write(this.factKey(e.value),e);this.changed();}
 async settledLocal(){for(;;){const tasks=[...this.writes];await Promise.all(tasks);if(!this.writes.size)return;}}
 async checkCustody(job){for(;;){await Promise.allSettled([...this.preparing.values(),...this.sending.values(),...this.admitting.values()]);if(job.expired)return false;await Promise.all([...this.observers]);if(job.expired)return false;const epoch=this.epoch;await this.settledLocal();if(job.expired)return false;const rows=[...[...this.intents].map(([id,e])=>[this.intentKey(id),e]),...[...this.cohorts].map(([id,e])=>[this.cohortKey(id),e]),...[...this.facts.values()].map(e=>[this.factKey(e.value),e])];const saved=await Promise.all(rows.map(([key,e])=>e.durable&&this.physical(key,e.value)));if(job.expired)return false;if(epoch!==this.epoch||this.writes.size||this.preparing.size||this.sending.size||this.admitting.size)continue;return saved.every(Boolean);}}
 async beforeLeave(){
  // A wait limit refuses navigation; it never cancels, releases or calls a pending write saved.
  if(!this.custodyCheck){const job={expired:false,deadline:Date.now()+this.custodyWaitMs};job.promise=this.checkCustody(job).catch(()=>false).finally(()=>{if(this.custodyCheck===job)this.custodyCheck=null;});this.custodyCheck=job;}
  const job=this.custodyCheck,remaining=job.deadline-Date.now();if(job.expired||remaining<=0){job.expired=true;return false;}
  let timeout;try{return await Promise.race([job.promise,new Promise(resolve=>timeout=setTimeout(()=>{job.expired=true;resolve(false);},remaining))]);}finally{clearTimeout(timeout);}
 }
 exportRecovery(){return{intents:[...this.intents.values()].map(x=>clone(x.value)),cohorts:[...this.cohorts.values()].map(x=>clone(x.value)),facts:[...this.facts.values()].map(x=>json(x.value,4000000)?clone(x.value):x.value),recoveries:this.recoveries};}
 destroy(){this.disposed=true;}
}
