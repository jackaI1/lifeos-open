import {draftProblem,storedDraftProblem} from './email-draft-schema.js';
const copy=value=>structuredClone(value),equal=(a,b)=>{try{return JSON.stringify(a)===JSON.stringify(b);}catch{return false;}};
const stamp=()=>new Date().toISOString();
export class EmailDrafts {
 constructor({store,environment,owner,onChange=()=>{}}){
  if(environment!=='beta')throw Error('Email preview is available only in beta.');
  if(typeof owner!=='string'||!owner.trim()||!owner.includes('@'))throw Error('A signed-in owner is required.');
  this.store=store;this.prefix='local-email:v1:beta:'+encodeURIComponent(owner.trim().toLowerCase())+':';this.entries=new Map();this.recoveries=[];this.unreadableCount=0;this.onChange=onChange;this.epoch=0;this.disposed=false;
 }
 key(value){return this.prefix+value.draftId+':'+value.branchId;}
 changed(){if(!this.disposed)this.onChange();}
 adopt(value,owned=false){const entry={value:copy(value),owned,durable:false,error:null,persistence:Promise.resolve(),editorBranch:null};this.entries.set(this.key(value),entry);return entry;}
 assertEntry(entry){if(!entry?.value||this.entries.get(this.key(entry.value))!==entry)throw Error('This draft entry does not belong to this owner/editor.');}
 async initialize(){
  const listed=await this.store.list(this.prefix),physical=typeof this.store.inspectPhysical==='function'?await this.store.inspectPhysical(this.prefix):[];
  const physicalMatches=(key,value)=>physical.some(row=>row.key===key&&!row.parseError&&!row.keyMismatch&&equal(row.value,value));
  const recover=row=>{if(!this.recoveries.some(saved=>saved.key===row.key&&saved.backend===row.backend&&saved.raw===row.raw&&equal(saved.value,row.value)))this.recoveries.push(copy(row));};
  for(const row of listed){const problem=storedDraftProblem(row.value,row.key,this.prefix),saved=physical.filter(item=>item.key===row.key&&!item.parseError&&equal(item.value,row.value)),original=saved.find(item=>typeof item.raw==='string')??saved[0]??row;
   if(problem){recover({...original,reason:problem});continue;}
   if(this.entries.has(this.key(row.value))){recover({...original,reason:'Another version of this draft identity is retained separately.'});continue;}
   const entry=this.adopt(row.value);entry.durable=physicalMatches(row.key,row.value);
   if(!entry.durable)entry.error='This stored draft has no verified device copy. Keep it open or download it, then retry saving.';
  }
  for(const row of physical){const represented=listed.find(item=>item.key===row.key&&equal(item.value,row.value));
   if(row.parseError||row.keyMismatch||storedDraftProblem(row.value,row.key,this.prefix)){
    recover(row);
   }else if(!represented)recover({...row,reason:'Another saved version is retained separately.'});
  }
  this.unreadableCount=new Set(this.recoveries.filter(row=>row.parseError||row.keyMismatch||storedDraftProblem(row.value,row.key,this.prefix)).map(row=>row.key)).size;
  this.changed();return this;
 }
 create(fields={},source){
  const value={schema:1,draftId:crypto.randomUUID(),branchId:crypto.randomUUID(),revision:0,updatedAt:stamp(),data:{to:'',cc:'',bcc:'',subject:'',body:'',...copy(fields)},...(source?{source:copy(source)}:{})};
  const entry=this.adopt(value,true);this.epoch++;return this.persist(entry).then(()=>entry);
 }
 fork(entry){
  this.assertEntry(entry);entry.owned=false;const value={...copy(entry.value),branchId:crypto.randomUUID(),parentBranchId:entry.value.branchId,revision:0,updatedAt:stamp()};
  const branch=this.adopt(value,true);this.epoch++;return branch;
 }
 beginEdit(entry){this.assertEntry(entry);if(entry.owned)return entry;if(!entry.editorBranch?.owned)entry.editorBranch=this.fork(entry);return entry.editorBranch;}
 edit(entry,patch){
  try{entry=this.beginEdit(entry);entry.value={...entry.value,revision:entry.value.revision+1,updatedAt:stamp(),data:{...entry.value.data,...copy(patch)}};this.epoch++;return this.persist(entry).then(()=>entry);}
  catch(error){return Promise.reject(error);}
 }
 persist(entry){
  this.assertEntry(entry);const snapshot=copy(entry.value),revision=snapshot.revision;entry.durable=false;entry.error=null;
  const count=new Set([...this.entries.values()].map(item=>item.value.draftId)).size,problem=count>100?'This preview can retain up to 100 local drafts. Your new writing is still here; download it.':draftProblem(snapshot);
  const task=entry.persistence.catch(()=>false).then(async()=>{
   if(problem){if(entry.value.revision===revision)entry.error=problem;return false;}
   try{const saved=await this.store.put(this.key(snapshot),snapshot);if(entry.value.revision===revision&&equal(entry.value,snapshot)){entry.durable=saved===true;entry.error=saved===true?null:'This device could not retain this writing. Keep this page open or download the draft.';}return saved===true;}
   catch{if(entry.value.revision===revision){entry.durable=false;entry.error='This device could not retain this writing. Keep this page open or download the draft.';}return false;}
  }).finally(()=>this.changed());entry.persistence=task;this.changed();return task;
 }
 retry(entry){this.assertEntry(entry);if(!entry.owned){const original=entry;entry=this.fork(entry);entry.owned=false;(original.retainedBy??=new Set()).add(entry);this.epoch++;return this.persist(entry).then(()=>entry);}this.epoch++;return this.persist(entry).then(()=>entry);}
 retained(entry,seen=new Set()){
  if(entry.durable)return true;if(seen.has(entry))return false;seen.add(entry);
  return [...(entry.retainedBy??[])].some(saved=>this.entries.get(this.key(saved.value))===saved&&saved.value.draftId===entry.value.draftId&&saved.value.parentBranchId===entry.value.branchId&&equal(saved.value.data,entry.value.data)&&equal(saved.value.source,entry.value.source)&&this.retained(saved,seen));
 }
 async beforeLeave(){
  for(;;){const epoch=this.epoch,entries=[...this.entries.values()],pending=entries.map(entry=>entry.persistence);await Promise.all(pending);
   if(epoch!==this.epoch||entries.some((entry,index)=>entry.persistence!==pending[index]))continue;
   return entries.every(entry=>this.retained(entry));
  }
 }
 dirty(){return [...this.entries.values()].some(entry=>!this.retained(entry));}
 leaves(){const parents=new Set([...this.entries.values()].filter(entry=>entry.value.parentBranchId&&entry.value.parentBranchId!==entry.value.branchId).map(entry=>this.key({...entry.value,branchId:entry.value.parentBranchId})));return [...this.entries.values()].filter(entry=>!parents.has(this.key(entry.value)));}
 destroy(){this.disposed=true;}
}
