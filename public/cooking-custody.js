// A bounded view proof. Expiry refuses leaving; original writes and the grocery
// receipt keeper remain alive. This module never starts a clock or sends a request.
const same=(left,right)=>left.length===right.length&&left.every((value,index)=>Object.is(value,right[index]));
export class CookingCustody {
 constructor({sessions,clocks,getReady,getView,getJournal=()=>null,getHelp=()=>null,waitMs=2000}){
  if(!sessions||!clocks||typeof getReady!=='function'||typeof getView!=='function'||typeof getJournal!=='function'||typeof getHelp!=='function'||!Number.isFinite(waitMs)||waitMs<1||waitMs>2000)throw Error('A cooking custody boundary is required.');
  Object.assign(this,{sessions,clocks,getReady,getView,getJournal,getHelp,waitMs});this.job=null;this.disposed=false;
 }
 stamp(){
  const view=this.getView(),journal=this.getJournal();
  const value=[this.disposed,view.eligible,view.selected,view.selected?.value.token,view.rawUnsaved,view.lease,view.groceryEpoch,this.sessions.epoch];
  for(const entry of this.sessions.entries.values())value.push(entry,entry.value.token,entry.persistence,entry.durable);
  value.push(this.clocks.pending.size);
  for(const [key,promise]of this.clocks.pending)value.push(key,promise);
  for(const [key,association]of this.clocks.associations)value.push(key,association);
  for(const [key,canceled]of this.clocks.cancellations)value.push(key,canceled);
  value.push(journal,journal?.epoch,journal?.writes.size,journal?.preparing.size,journal?.sending.size,journal?.admitting.size,journal?.observers.size);
  const help=this.getHelp();value.push(help,help?.epoch,help?.writes.size,help?.preparing.size,help?.admitting.size,help?.observers.size,help?.adopting.size);
  const helpScope=help?.getScope();value.push(helpScope?.owner,helpScope?.environment,helpScope?.viewLease,helpScope?.entry,helpScope?.entry?.value.token,helpScope?.stepId,helpScope?.routeHash,helpScope?.rawUnsaved);
  if(help)for(const map of [help.drafts,help.intents,help.facts,help.adoptions])for(const entry of map.values())value.push(entry,entry.value.token,entry.persistence,entry.durable);
  if(help)value.push(...help.recoveryStamp());
  return value;
 }
 locallyReady(){
  const view=this.getView(),journal=this.getJournal(),help=this.getHelp();
  return !this.disposed&&view.eligible&&!view.rawUnsaved&&!this.clocks.pending.size&&!this.sessions.dirty()&&
   (!journal||!journal.writes.size&&!journal.preparing.size&&!journal.sending.size&&!journal.admitting.size&&!journal.observers.size&&
    [...journal.intents.values(),...journal.cohorts.values(),...journal.facts.values()].every(entry=>entry.durable))&&
   (!help||!help.disposed&&help.getScope()?.owner===help.owner&&help.getScope()?.environment==='beta'&&!help.writes.size&&!help.preparing.size&&!help.admitting.size&&!help.observers.size&&!help.adopting.size&&[...help.drafts.values(),...help.intents.values(),...help.facts.values(),...help.adoptions.values()].every(entry=>entry.durable));
 }
 current(){return !!this.job?.proof&&!this.job.expired&&this.job.deadline>Date.now()&&this.locallyReady()&&same(this.job.proof,this.stamp());}
 async read(job){
  await this.getReady();if(job.expired||this.disposed)return false;
  for(;;){
   if(job.expired||!this.getView().eligible||this.getView().rawUnsaved)return false;
   const before=this.stamp(),entries=[...this.sessions.entries.values()],journal=this.getJournal(),help=this.getHelp();
   await Promise.allSettled([...entries.map(entry=>entry.persistence),...this.clocks.pending.values()]);
   if(job.expired||this.disposed)return false;
   if(!same(before,this.stamp()))continue;
   const physical=await Promise.all(entries.map(entry=>this.sessions.retained(entry)));
   if(job.expired||this.disposed)return false;
   if(!same(before,this.stamp()))continue;
   if(!physical.every(Boolean))return false;
   const clocksSaved=await Promise.all([
    ...[...this.clocks.associations.values()].map(value=>this.clocks.physical(this.clocks.key(value),value)),
    ...[...this.clocks.cancellations.values()].map(value=>this.clocks.physical(this.clocks.prefix+'canceled:'+value.clockId,value)),
   ]);
   if(job.expired||this.disposed)return false;
   if(!same(before,this.stamp()))continue;
   if(!clocksSaved.every(Boolean))return false;
   const journalSaved=!journal||await journal.checkCustody(job);
   if(job.expired||this.disposed)return false;
   if(!same(before,this.stamp()))continue;
   if(!journalSaved)return false;
   const helpSaved=!help||await help.checkCustody(job);
   if(job.expired||this.disposed)return false;
   if(!same(before,this.stamp()))continue;
   if(!helpSaved||!this.locallyReady())return false;
   job.proof=this.stamp();return true;
  }
 }
 launch(job){
  job.proof=null;job.settled=false;job.work=this.read(job).catch(()=>false).finally(()=>{job.settled=true;});return job;
 }
 async observe(job){
  const remaining=job.deadline-Date.now();if(job.expired||remaining<=0){job.expired=true;return false;}
  let timer;try{const result=await Promise.race([job.work,new Promise(resolve=>{timer=setTimeout(()=>{job.expired=true;resolve(false);},remaining);})]);if(job.expired||job.deadline<=Date.now()){job.expired=true;return false;}return result;}finally{clearTimeout(timer);}
 }
 beforeLeave(){
  // A distinct attempt needs fresh physical originals, even when the controller
  // stamp is unchanged. Repeated outstanding checks keep their original budget.
  if(!this.job||this.job.settled||this.job.expired){this.job=this.launch({deadline:Date.now()+this.waitMs,expired:false,proof:null,settled:false});}
  return this.observe(this.job);
 }
 finalBeforeLeave(){
  const job=this.job;if(!job||job.expired||job.deadline<=Date.now())return Promise.resolve(false);
  // After native pause/blur, re-read physical originals within the SAME attempt's
  // original deadline. An unchanged memory stamp cannot skip this witness.
  if(job.settled)this.launch(job);return this.observe(job);
 }
 dirty(){return !this.locallyReady();}
 destroy(){this.disposed=true;}
}
