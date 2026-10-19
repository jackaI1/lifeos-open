const copy=value=>structuredClone(value);
const equal=(a,b)=>{
 if(!jsonValue(a)||!jsonValue(b))return false;
 const pending=[[a,b]];
 while(pending.length){const [left,right]=pending.pop();if(Object.is(left,right))continue;
  if(left===null||right===null||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right))return false;
  const keys=Object.keys(left);if(keys.length!==Object.keys(right).length)return false;
  for(const key of keys){if(!Object.hasOwn(right,key))return false;pending.push([left[key],right[key]]);}
 }return true;
};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const stamp=()=>new Date().toISOString();
const sameWriting=(a,b)=>equal(a.source,b.source)&&equal(a.notes,b.notes)&&equal(a.steps,b.steps)&&equal(a.ingredients,b.ingredients)&&Object.hasOwn(a,'position')===Object.hasOwn(b,'position')&&(!Object.hasOwn(a,'position')||equal(a.position,b.position));
function positionProblem(value){
 if(!Object.hasOwn(value,'position'))return null;
 const position=value.position;
 if(!position||typeof position!=='object'||Array.isArray(position)||Object.keys(position).length!==2||!Object.hasOwn(position,'stepId')||!Object.hasOwn(position,'mode')||!['prepare','follow'].includes(position.mode)||position.stepId!==null&&(!uuid(position.stepId)||!Array.isArray(value.steps)||value.steps.filter(step=>step?.id===position.stepId).length!==1))return 'Choose an exact cooking step and a recognized view position.';
 return null;
}
// Only bounded, lossless JSON values can be called saved on either device backend.
// Refuse unsupported caller values before cloning/writing; never normalize originals.
function jsonValue(value,{liveWriting=false}={}){
 const pending=[{value,depth:0}],ancestors=new Set();let nodes=0,text=0;
 try{while(pending.length){const next=pending.pop(),part=next.value;if(next.exit){ancestors.delete(part);continue;}
  if(++nodes>25000&&!liveWriting||next.depth>64)return false;
  if(typeof part==='string'){if((text+=part.length)>2000000&&!liveWriting)return false;continue;}
  if(part===null||typeof part==='boolean')continue;
  if(typeof part==='number'){if(!Number.isFinite(part)||Object.is(part,-0))return false;continue;}
  if(typeof part!=='object'||ancestors.has(part)||(!Array.isArray(part)&&Object.getPrototypeOf(part)!==Object.prototype))return false;
  const keys=Reflect.ownKeys(part),array=Array.isArray(part);
  if(keys.length>25000&&!liveWriting||array&&(keys.length!==part.length+1||keys.at(-1)!=='length'))return false;
  ancestors.add(part);pending.push({value:part,exit:true});
  for(const key of keys){if(array&&key==='length')continue;
   if(typeof key!=='string'||(text+=key.length)>2000000&&!liveWriting||array&&!/^(0|[1-9]\d*)$/.test(key))return false;
   const field=Object.getOwnPropertyDescriptor(part,key);
   if(!field?.enumerable||!Object.hasOwn(field,'value'))return false;
   pending.push({value:field.value,depth:next.depth+1});
  }
 }return true;}catch{return false;}
}
function problem(value){
 // A physical size cap must never prevent ordinary oversized writing from
 // remaining in the live editor. Inspect data fields without invoking accessors.
 try{const notes=Object.getOwnPropertyDescriptor(value,'notes')?.value,steps=Object.getOwnPropertyDescriptor(value,'steps')?.value,ingredients=Object.getOwnPropertyDescriptor(value,'ingredients')?.value;
  if(typeof notes==='string'&&notes.length>10000)return 'Local notes exceed the 10,000 character limit. Your writing is still here.';
  if(Array.isArray(steps)&&steps.length>80)return 'Keep at most 80 separately identified steps. Your writing is still here.';
  if(Array.isArray(ingredients)&&ingredients.length>100)return 'Keep at most 100 separately identified ingredients. Your writing is still here.';
 }catch{}
 if(!jsonValue(value))return 'This cooking session contains a value this preview cannot save exactly. Keep the original or download it.';
 if(!value||value.schema!==1||!uuid(value.cookId)||!uuid(value.branchId)||!uuid(value.token)||value.parentBranchId!==undefined&&(!uuid(value.parentBranchId)||value.parentBranchId===value.branchId))return 'This cooking session has an unrecognized identity.';
 if(Object.keys(value).some(key=>!['schema','cookId','branchId','parentBranchId','token','revision','updatedAt','source','notes','steps','ingredients','position'].includes(key)))return 'This cooking session contains fields this preview cannot interpret.';
 if(!Number.isInteger(value.revision)||value.revision<0||typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.updatedAt)))return 'This cooking session has an unrecognized revision.';
 const source=value.source;if(!source||source.kind!=='meal'||typeof source.id!=='string'||!/^[\w-]{1,200}$/.test(source.id)||!Number.isInteger(source.version)||source.version<1||!source.data||Array.isArray(source.data)||!jsonValue(source))return 'Choose a saved recipe with an identifiable revision.';
 if(typeof value.notes!=='string'||value.notes.length>10000)return 'Local notes exceed the 10,000 character limit. Your writing is still here.';
 if(!Array.isArray(value.steps)||value.steps.length>80||new Set(value.steps.map(step=>step?.id)).size!==value.steps.length)return 'Keep at most 80 separately identified steps. Your writing is still here.';
 for(const step of value.steps)if(!step||!uuid(step.id)||typeof step.text!=='string'||step.text.length>4000||typeof step.reviewed!=='boolean'||typeof step.done!=='boolean'||step.minutes!==null&&(!Number.isInteger(step.minutes)||step.minutes<1||step.minutes>240)||Object.keys(step).some(key=>!['id','text','reviewed','done','minutes'].includes(key)))return 'Review each step and its optional timer. Step text has a 4,000 character limit.';
 if(!Array.isArray(value.ingredients)||value.ingredients.length>100||new Set(value.ingredients.map(item=>item?.id)).size!==value.ingredients.length)return 'Keep at most 100 separately identified ingredients. Your writing is still here.';
 for(const item of value.ingredients)if(!item||!uuid(item.id)||typeof item.text!=='string'||item.text.length>300||typeof item.need!=='boolean'||Object.keys(item).some(key=>!['id','text','need'].includes(key)))return 'Review each ingredient. Ingredient text has a 300 character limit.';
 return positionProblem(value);
}

export class CookingSessions {
 constructor({store,environment,owner,onChange=()=>{}}){
  if(environment!=='beta')throw Error('Cooking preview is available only in beta.');
  if(typeof owner!=='string'||!owner.trim()||!owner.includes('@'))throw Error('A signed-in owner is required.');
  this.store=store;this.prefix='local-cooking:v1:beta:'+encodeURIComponent(owner.trim().toLowerCase())+':';this.entries=new Map();this.recoveries=[];this.onChange=onChange;this.epoch=0;this.disposed=false;
 }
 key(value){return this.prefix+value.cookId+':'+value.branchId;}
 changed(){if(!this.disposed)this.onChange();}
 assertEntry(entry){if(this.disposed)throw Error('This cooking editor has closed.');if(!entry?.value||this.entries.get(this.key(entry.value))!==entry)throw Error('This cooking entry does not belong to this owner/editor.');}
 adopt(value,owned=false){const entry={value:copy(value),owned,durable:false,error:null,persistence:Promise.resolve(),editorBranch:null};this.entries.set(this.key(value),entry);return entry;}
 async physicallyRetained(value){
  const key=this.key(value);if(typeof this.store.isDurable!=='function'||typeof this.store.inspectPhysical!=='function'||await this.store.isDurable(key,value.token)!==true)return false;
  return (await this.store.inspectPhysical(key)).some(row=>row.key===key&&!row.parseError&&!row.keyMismatch&&equal(row.value,value));
 }
 async initialize(){
  const listed=await this.store.list(this.prefix),physical=typeof this.store.inspectPhysical==='function'?await this.store.inspectPhysical(this.prefix):[];
  const recover=row=>{if(!this.recoveries.some(saved=>saved.key===row.key&&saved.backend===row.backend&&saved.raw===row.raw&&(saved.value===row.value||equal(saved.value,row.value)))){
   // Deep/non-JSON values stay opaque and reachable; raw bytes are kept verbatim.
   // A recursive clone must not prevent adjacent valid sessions from reopening.
   this.recoveries.push(jsonValue(row)?copy(row):{...row,unsupportedValue:true});
  }};
  for(const row of listed){const reason=problem(row.value);if(reason||row.key!==this.key(row.value)){const original=physical.find(item=>item.key===row.key&&equal(item.value,row.value))??row;recover({...original,reason:reason||'The saved identity does not match its device key.'});continue;}
   const entry=this.adopt(row.value);entry.durable=await this.physicallyRetained(entry.value);if(!entry.durable)entry.error='This cooking session has no verified device copy. Keep it open or download it, then retry saving.';
  }
  for(const row of physical)if(row.parseError||row.keyMismatch||problem(row.value)||row.key!==this.key(row.value)||!listed.some(item=>item.key===row.key&&equal(item.value,row.value)))recover(row);
  this.changed();return this;
 }
 create(source){
  if(this.disposed)return Promise.reject(Error('This cooking editor has closed.'));
  if(!jsonValue(source))return Promise.reject(Error('This recipe contains a value this preview cannot save exactly. Keep the original or download it.'));
  const value={schema:1,cookId:crypto.randomUUID(),branchId:crypto.randomUUID(),token:crypto.randomUUID(),revision:0,updatedAt:stamp(),source:copy(source),notes:'',steps:(Array.isArray(source.data.steps)?source.data.steps:[]).map(step=>({id:crypto.randomUUID(),text:step.text,minutes:step.minutes??null,reviewed:false,done:false})),ingredients:(Array.isArray(source.data.ingredients)?source.data.ingredients:[]).map(text=>({id:crypto.randomUUID(),text:String(text),need:false})),position:{stepId:null,mode:'prepare'}};
  const reason=problem(value);if(reason)return Promise.reject(Error(reason));const entry=this.adopt(value,true);this.epoch++;return this.persist(entry).then(()=>entry);
 }
 fork(entry){
  this.assertEntry(entry);entry.owned=false;const value={...copy(entry.value),branchId:crypto.randomUUID(),parentBranchId:entry.value.branchId,token:crypto.randomUUID(),revision:0,updatedAt:stamp()};
  const branch=this.adopt(value,true);this.epoch++;return branch;
 }
 beginEdit(entry){this.assertEntry(entry);if(entry.owned)return entry;if(!entry.editorBranch?.owned)entry.editorBranch=this.fork(entry);return entry.editorBranch;}
 edit(entry,patch){
  try{this.assertEntry(entry);if(!patch||Object.keys(patch).some(key=>!['notes','steps','ingredients','position'].includes(key)))throw Error('Only local notes, steps, ingredients and view position can be edited.');if(!jsonValue(patch,{liveWriting:true}))throw Error('This local edit contains a value this preview cannot save exactly. Keep the original or download it.');const fields=copy(patch),positionError=positionProblem({...entry.value,...fields});if(positionError)throw Error(positionError);entry=this.beginEdit(entry);entry.value={...entry.value,...fields,revision:entry.value.revision+1,token:crypto.randomUUID(),updatedAt:stamp()};this.epoch++;return this.persist(entry).then(()=>entry);}
  catch(error){return Promise.reject(error);}
 }
 persist(entry){
  this.assertEntry(entry);const snapshot=copy(entry.value),token=snapshot.token;entry.durable=false;entry.error=null;
  const reason=new Set([...this.entries.values()].map(item=>item.value.cookId)).size>100?'This preview retains up to 100 cooking sessions. Download your new session.':problem(snapshot);
  const task=entry.persistence.catch(()=>false).then(async()=>{
   if(reason){if(entry.value.token===token)entry.error=reason;return false;}
   try{const saved=await this.store.put(this.key(snapshot),snapshot),durable=saved===true&&await this.physicallyRetained(snapshot);if(entry.value.token===token&&equal(entry.value,snapshot)){entry.durable=durable;entry.error=durable?null:'This device could not retain your cooking progress. Keep this page open or download it.';}return durable;}
   catch{if(entry.value.token===token){entry.durable=false;entry.error='This device could not retain your cooking progress. Keep this page open or download it.';}return false;}
  }).finally(()=>this.changed());entry.persistence=task;this.changed();return task;
 }
 retry(entry){this.assertEntry(entry);if(!entry.owned){const parent=entry;entry=this.fork(entry);entry.owned=false;(parent.retainedBy??=new Set()).add(entry);this.epoch++;return this.persist(entry).then(()=>entry);}this.epoch++;return this.persist(entry).then(()=>entry);}
 async retained(entry,seen=new Set()){
  if(entry.durable&&await this.physicallyRetained(entry.value))return true;if(seen.has(entry))return false;seen.add(entry);
  for(const saved of entry.retainedBy??[])if(this.entries.get(this.key(saved.value))===saved&&saved.value.cookId===entry.value.cookId&&saved.value.parentBranchId===entry.value.branchId&&sameWriting(saved.value,entry.value)&&await this.retained(saved,seen))return true;return false;
 }
 async beforeLeave(){for(;;){const epoch=this.epoch,entries=[...this.entries.values()],pending=entries.map(entry=>entry.persistence);await Promise.all(pending);if(epoch!==this.epoch||entries.some((entry,index)=>entry.persistence!==pending[index]))continue;const retained=await Promise.all(entries.map(entry=>this.retained(entry)));if(epoch!==this.epoch)continue;return retained.every(Boolean);}}
 cachedRetained(entry,seen=new Set()){if(entry.durable)return true;if(seen.has(entry))return false;seen.add(entry);return [...(entry.retainedBy??[])].some(saved=>this.entries.get(this.key(saved.value))===saved&&saved.value.cookId===entry.value.cookId&&saved.value.parentBranchId===entry.value.branchId&&sameWriting(saved.value,entry.value)&&this.cachedRetained(saved,seen));}
 dirty(){return [...this.entries.values()].some(entry=>!this.cachedRetained(entry));}
 leaves(){const parents=new Set([...this.entries.values()].filter(entry=>entry.value.parentBranchId).map(entry=>this.key({...entry.value,branchId:entry.value.parentBranchId})));return [...this.entries.values()].filter(entry=>!parents.has(this.key(entry.value)));}
 destroy(){this.disposed=true;}
}
