const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const copy=value=>structuredClone(value);
function same(a,b){
 const pending=[[a,b,0]];let nodes=0,text=0;
 try{while(pending.length){const [left,right,depth]=pending.pop();if(++nodes>50000||depth>70)return false;
  if(left===null||typeof left!=='object'){
   if(!Object.is(left,right)||!['string','number','boolean'].includes(typeof left)&&left!==null||typeof left==='number'&&(!Number.isFinite(left)||Object.is(left,-0)))return false;
   if(typeof left==='string'&&(text+=left.length)>4000000)return false;continue;
  }
  if(right===null||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right)||!Array.isArray(left)&&(Object.getPrototypeOf(left)!==Object.prototype||Object.getPrototypeOf(right)!==Object.prototype))return false;
  const keys=Reflect.ownKeys(left),other=Reflect.ownKeys(right),array=Array.isArray(left);
  if(keys.length>25000||keys.length!==other.length||array&&(left.length!==right.length||keys.length!==left.length+1||keys.at(-1)!=='length'||other.at(-1)!=='length'))return false;
  for(const key of keys){if(array&&key==='length')continue;if(typeof key!=='string'||(text+=key.length)>4000000)return false;
   const l=Object.getOwnPropertyDescriptor(left,key),r=Object.getOwnPropertyDescriptor(right,key);
   if(!l?.enumerable||!r?.enumerable||!Object.hasOwn(l,'value')||!Object.hasOwn(r,'value'))return false;pending.push([l.value,r.value,depth+1]);
  }
 }return true;}catch{return false;}
}
const cookingRoute=cookId=>'#reminders?view=cooking&session='+cookId;
function valid(value){
 if(!same(value,value)||value?.schema!==1||!uuid(value.clockId)||!uuid(value.token)||!uuid(value.session?.cookId)||!uuid(value.session?.branchId)||!uuid(value.session?.token))return false;
 if(Object.keys(value).some(key=>!['schema','clockId','token','session','step','routeHash','options','preparedAt'].includes(key)))return false;
 const step=value.step,options=value.options;
 return value.routeHash===cookingRoute(value.session.cookId)&&typeof value.preparedAt==='string'&&Number.isFinite(Date.parse(value.preparedAt))&&
  uuid(step?.id)&&step.reviewed===true&&step.done===false&&typeof step.text==='string'&&step.text.trim().length>0&&Number.isInteger(step.minutes)&&step.minutes>=1&&step.minutes<=240&&
  Array.isArray(value.session.steps)&&value.session.steps.some(saved=>saved.id===step.id&&same(saved,step))&&
  options?.category==='Cooking'&&options.target===null&&options.automatic===false&&options.durationMs===step.minutes*60000&&typeof options.title==='string'&&options.title.length<=300&&
  Object.keys(options).length===5;
}

export class CookingTimers{
 constructor({sessions,timers,getSelection,routeHash,onChange=()=>{}}){
  if(!sessions?.prefix?.startsWith('local-cooking:v1:beta:')||typeof getSelection!=='function'||typeof routeHash!=='function')throw Error('A signed-in cooking workspace is required.');
  this.sessions=sessions;this.store=sessions.store;this.timers=timers;this.getSelection=getSelection;this.routeHash=routeHash;this.onChange=onChange;
  this.prefix=sessions.prefix.replace('local-cooking:','local-cooking-clock:');this.associations=new Map();this.cancellations=new Map();this.recoveries=[];this.pending=new Map();this.disposed=false;
 }
 key(value){return this.prefix+value.clockId;}
 changed(){if(!this.disposed)this.onChange();}
 async physical(key,value){return typeof this.store.isDurable==='function'&&typeof this.store.inspectPhysical==='function'&&await this.store.isDurable(key,value.token)===true&&(await this.store.inspectPhysical(key)).some(row=>row.key===key&&!row.parseError&&!row.keyMismatch&&same(row.value,value));}
 async initialize(){
  const rows=typeof this.store.inspectPhysical==='function'?await this.store.inspectPhysical(this.prefix):[];
  for(const row of rows){const value=row.value;
   if(!row.parseError&&!row.keyMismatch&&valid(value)&&row.key===this.key(value)&&await this.physical(row.key,value))this.associations.set(value.clockId,copy(value));
   else if(!row.parseError&&!row.keyMismatch&&same(value,value)&&value?.schema===1&&value.state==='canceled-before-start'&&uuid(value.clockId)&&uuid(value.associationToken)&&uuid(value.token)&&Object.keys(value).length===6&&typeof value.at==='string'&&Number.isFinite(Date.parse(value.at))&&row.key===this.prefix+'canceled:'+value.clockId&&await this.physical(row.key,value))this.cancellations.set(value.clockId,copy(value));
   else this.recoveries.push(same(row,row)?copy(row):{...row,unsupportedValue:true});
  }
  this.changed();return this;
 }
 forEntry(entry){this.sessions.assertEntry(entry);return [...this.associations.values()].filter(value=>value.session.cookId===entry.value.cookId).map(copy);}
 start(entry,stepId){
  try{this.sessions.assertEntry(entry);if(this.disposed)throw Error('This cooking timer view has closed.');const key=entry.value.cookId+':'+stepId;
   if(this.pending.has(key))return this.pending.get(key);
   const operation=this.startCurrent(entry,stepId).finally(()=>{if(this.pending.get(key)===operation)this.pending.delete(key);this.changed();});this.pending.set(key,operation);this.changed();return operation;
  }catch(error){return Promise.reject(error);}
 }
 async startCurrent(entry,stepId){
  const snapshot=copy(entry.value),step=snapshot.steps.find(value=>value.id===stepId),route=cookingRoute(snapshot.cookId);
  const current=()=>!this.disposed&&!this.sessions.disposed&&this.getSelection()===entry&&this.routeHash()===route&&entry.value.token===snapshot.token&&same(entry.value,snapshot);
  if(!current()||!step?.reviewed||step.done||!step.text.trim()||!Number.isInteger(step.minutes)||step.minutes<1||step.minutes>240)throw Error('Choose the current reviewed step and its timer before starting.');
  await entry.persistence;if(!current()||!await this.sessions.physicallyRetained(snapshot)||!current())throw Error('Save this exact cooking step on the device before starting its timer.');
  for(const value of this.forEntry(entry).filter(value=>value.step.id===stepId)){
   const row=this.timers.rows.get(value.clockId),canceled=this.cancellations.get(value.clockId);
   if(row?.data.state==='finished')continue;
   if(!row&&canceled?.associationToken===value.token&&await this.physical(this.prefix+'canceled:'+value.clockId,canceled))continue;
   throw Error(row?'Use the existing timer for this step.':'A retained timer start is uncertain. Review its existing timer before starting another.');
  }
  if(!current())throw Error('The selected cooking step changed. Review it again before starting.');
  const title=('Step '+(snapshot.steps.findIndex(value=>value.id===stepId)+1)+' · '+(snapshot.source.data.title||'Recipe')).slice(0,300);
  const options={title,category:'Cooking',target:null,durationMs:step.minutes*60000,automatic:false};let association;
  const row=await this.timers.start(options,{canStart:current,resumeOnVisibility:false,retainCreated:async native=>{
   if(!current()||native.routeHash!==route||!uuid(native.id)||!same(native.options,options))return false;
   const value={schema:1,clockId:native.id,token:crypto.randomUUID(),session:copy(snapshot),step:copy(step),routeHash:route,options:copy(native.options),preparedAt:new Date().toISOString()},key=this.key(value);
   if((await this.store.inspectPhysical(key)).some(saved=>saved.key===key))throw Error('Preserve the existing timer association before starting another.');
   if(!current()||await this.store.put(key,value)!==true||!await this.physical(key,value))throw Error('This device could not retain the exact cooking timer association. Keep this page open and retry saving.');
   association=value;this.associations.set(value.clockId,copy(value));this.changed();return true;
  }});
  // Native undefined is the proven pre-publication route/visibility/lifetime fence.
  // A thrown/uncertain delivery is never reclassified as a canceled or replayable start.
  if(!row&&association&&!this.timers.rows.has(association.clockId)){
   const canceled={schema:1,state:'canceled-before-start',clockId:association.clockId,associationToken:association.token,token:crypto.randomUUID(),at:new Date().toISOString()},key=this.prefix+'canceled:'+association.clockId;
   if(await this.store.put(key,canceled)===true&&await this.physical(key,canceled))this.cancellations.set(association.clockId,canceled);
  }
  this.changed();return row;
 }
 destroy(){this.disposed=true;}
}
