// Separate browser database and owner routes. Never pass these drafts to an AI/outbox consumer.
export class MomentDraft {
 constructor({store,request,key,path,changed=()=>{}}){Object.assign(this,{store,request,key,path,changed});this.value=null;this.saving=null;this.durable=true;this.error=null;this.persistence=Promise.resolve();}
 async open(item,initial){const cached=await this.store.get(this.key);this.value=(cached?.dirty||cached?.pending?cached:null)??{data:structuredClone(item?.data??initial),version:item?.version??0,dirty:!item,updatedAt:item?.updatedAt??null,pending:null};this.changed(this);return this.value;}
 persist(){const copy=structuredClone(this.value);this.persistence=this.store.put(this.key,copy).then(ok=>{this.durable=ok;this.changed(this);return ok;});return this.persistence;}
 edit(data,extra){this.value={...this.value,data:structuredClone(data),...(extra?{photo:extra}:{}),dirty:true};this.error=null;return this.persist();}
 save(){if(this.saving)return this.saving;this.saving=this.flush().finally(()=>{this.saving=null;this.changed(this);});this.changed(this);return this.saving;}
 async flush(){
  await this.persistence;
  // Replay an uncertain response before creating the next revision. At most two writes per Save.
  for(let i=0;i<2;i++){
   if(!this.value.dirty&&!this.value.pending)return;
   const pending=this.value.pending??{mutationId:crypto.randomUUID(),version:this.value.version,data:structuredClone(this.value.data),...(this.value.photo?{photo:this.value.photo}:{})};
   this.value.pending=pending;await this.persist();if(!navigator.onLine){this.changed(this);return;}
   try{const {item}=await this.request(this.path,{method:'PUT',body:pending});const same=JSON.stringify(this.value.data)===JSON.stringify(pending.data)&&JSON.stringify(this.value.photo)===JSON.stringify(pending.photo);this.value={...this.value,version:item.version,updatedAt:item.updatedAt,pending:null,dirty:!same};if(JSON.stringify(this.value.photo)===JSON.stringify(pending.photo))delete this.value.photo;this.error=null;await this.persist();if(same)return;}
   catch(error){this.error=error;await this.persist();throw error;}
  }
 }
 async canLeave(){await this.persistence;return this.durable||!this.value?.dirty;}
}
