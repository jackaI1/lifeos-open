import {el,replace,button,field,modal,busy,download,formatDate,toast,getDisplayTimeZone} from './ui.js';
import {lifeosDay} from './lifeos-day.js';

export const effectiveRunDay=(record,timeZone=getDisplayTimeZone())=>record.data.completedAt?lifeosDay(record.data.completedAt,timeZone):record.data.date;
const editable=data=>Object.fromEntries(['date','distanceKm','durationMinutes','effort','pain','fatigue','notes','workoutId'].filter(key=>data[key]!==undefined).map(key=>[key,data[key]]));

// A run retains one record identity and one exact pending write. Opening/reopening
// never sends it. A receipt retires only its sent text, preserving later typing.
export async function createRunLog(ctx,{describe,onChange=()=>{},onSaved=()=>{}}){
 let disposed=false;const entries=new Map(),confirmed=new Map(),checking=new Map();
 const key=id=>'draft:run:'+id;
 const changed=()=>{if(!disposed)onChange();};
 const exportEntry=entry=>download('lifeos-run-draft.json',JSON.stringify(entry.value,null,2),'application/json');
 function adopt(value){const entry={value,durable:false,persistence:Promise.resolve(),saving:null,form:null,status:null,error:null};entries.set(value.id,entry);return entry;}
 async function persist(entry){const snapshot=structuredClone(entry.value),token=snapshot.token;entry.durable=false;entry.persistence=entry.persistence.catch(()=>false).then(()=>ctx.store.put(key(snapshot.id),snapshot)).then(ok=>{if(entry.value.token===token)entry.durable=ok!==false;paint(entry);changed();return ok!==false;}).catch(()=>{if(entry.value.token===token)entry.durable=false;paint(entry);changed();return false;});return entry.persistence;}
 function paint(entry){if(disposed||!entry.status||!document.querySelector('#dialog')?.contains(entry.form))return;
  entry.status.textContent=entry.saving?'Saving run…':entry.value.needsReview?'Review the saved run before deciding.':entry.value.pending?'Run saved on this device; waiting to sync.':entry.value.dirty?'Draft saved on this device':entry.value.version?'Saved to LifeOS':'Not saved yet';
  if(entry.reviewButton)entry.reviewButton.hidden=!entry.value.needsReview;
  if(entry.error)entry.status.textContent=entry.error.message;
  else if(entry.saving)entry.status.textContent='Saving run…';
  else if((entry.value.dirty||entry.value.pending)&&!entry.durable)entry.status.textContent='This device could not retain your run. Keep this page open or download the draft.';
 }
 for(const {value}of await ctx.store.list('draft:run:'))if(value?.id&&value?.data?.date&&(value.dirty||value.pending)){const entry=adopt(value);await persist(entry);}
 function putInRecords(item){const witness=confirmed.get(item.id);if(witness&&item.version<witness.version)return;if(!witness||witness.version<=item.version)confirmed.set(item.id,structuredClone(item));const rows=ctx.state.bootstrap.records.run??=[];const at=rows.findIndex(row=>row.id===item.id);if(at<0)rows.push(item);else if(rows[at].version<=item.version)rows[at]=item;}
 async function reconcile(){
  for(const [id,witness]of confirmed){const current=ctx.records('run').find(row=>row.id===id);if(current){if(current.version<witness.version)putInRecords(witness);else if(current.version>witness.version)confirmed.set(id,structuredClone(current));continue;}
   // Absence can mean deletion. Verify only this ID before restoring a view row.
   if(!checking.has(id)){const operation=(async()=>{for(let attempt=0;attempt<2;attempt++){const readFloor=confirmed.get(id);if(!readFloor||disposed)return;
    try{const {item}=await ctx.request('/api/records/run/'+encodeURIComponent(id));if(disposed)return;const latest=confirmed.get(id);if(!latest)return;
     if(item?.id===id&&Number.isSafeInteger(item.version)&&item.version>=latest.version){putInRecords(item);return;}
     if(latest.version>readFloor.version&&attempt===0)continue;return;
    }catch(error){if(disposed)return;const latest=confirmed.get(id);if(!latest)return;
     if(latest.version>readFloor.version&&attempt===0)continue;
     if([404,410].includes(error.status)&&latest.version===readFloor.version)confirmed.delete(id);return;
    }
   }})().finally(()=>checking.delete(id));checking.set(id,operation);}await checking.get(id);
  }
 }
 async function save(entry,saveForm,returnFocus,openedRoute){
  if(entry.saving)return entry.saving;if(entry.value.needsReview){entry.error=Error('A newer run is saved. Review the saved run before deciding.');paint(entry);return false;}
  const captured=entry.value.pending??{mutationId:crypto.randomUUID(),version:entry.value.version,data:structuredClone(entry.value.data)};
  const operation=(async()=>{await entry.persistence;entry.value.pending??=captured;
   const pending=entry.value.pending;await persist(entry);
   try{const result=await ctx.outbox.submit('/api/records/run/'+encodeURIComponent(entry.value.id),pending,'PUT');
    if(!result.item){if(!result.pending)throw Error('The run save was not confirmed. Your original request is retained.');entry.error=null;await persist(entry);return false;}
    if(result.item.id!==entry.value.id||!Number.isSafeInteger(result.item.version)||result.item.version<=pending.version)throw Error('The run receipt did not confirm this dated request. Your draft is retained.');
    putInRecords(result.item);const newerVersion=Math.max(confirmed.get(entry.value.id)?.version??0,ctx.records('run').find(row=>row.id===entry.value.id)?.version??0);let same=JSON.stringify(entry.value.data)===JSON.stringify(pending.data);
    entry.value={...entry.value,version:Math.max(entry.value.version,result.item.version),pending:null,dirty:!same,needsReview:newerVersion>result.item.version};entry.error=entry.value.needsReview?Error('A newer run is saved. Review it before saving your draft.'):null;if(entry.value.needsReview){same=false;entry.value.dirty=true;}
    if(same){const token=entry.value.token;await ctx.store.remove(key(entry.value.id),token);same=entry.value.token===token;if(same){entries.delete(entry.value.id);entry.durable=true;}else{entry.value.dirty=true;await persist(entry);}}else await persist(entry);
    if(!disposed){onSaved(result.item);const dialog=document.querySelector('#dialog');if(same&&entry.form===saveForm&&dialog?.contains(saveForm)){dialog.close();if(!disposed&&!dialog.open&&location.hash===openedRoute){const target=returnFocus?.();if(target?.isConnected)target.focus({preventScroll:true});}}}
    return same;
   }catch(error){entry.error=error;if(error.status&&error.status>=400&&error.status<500&&![401,429].includes(error.status))entry.value.needsReview=true;await persist(entry);return false;}
  })();entry.saving=operation;paint(entry);try{return await operation;}finally{entry.saving=null;paint(entry);changed();}
 }
 const highestKnown=id=>Math.max(confirmed.get(id)?.version??0,ctx.records('run').find(row=>row.id===id)?.version??0);
 async function reviewSavedRun(entry,expectedView=entry.form){
  const openedForm=entry.form;
  try{const {item}=await ctx.request('/api/records/run/'+encodeURIComponent(entry.value.id));if(!item||item.id!==entry.value.id||!Number.isSafeInteger(item.version))throw Error('The saved run could not be verified. Your draft is retained.');if(disposed||entry.form!==openedForm||!document.querySelector('#dialog')?.contains(expectedView))return;
   if(item.version<highestKnown(entry.value.id)){entry.error=Error('A newer run is saved. Review it again before deciding.');paint(entry);toast(entry.error.message);return;}
   let choosing=false;const reviewed=structuredClone(entry.value),reviewContent=el('div',{class:'form-stack'});
   const summary=data=>el('dl',{class:'exercise-run-comparison'},el('dt',{},'Run date'),el('dd',{},formatDate(effectiveRunDay({data}),true)),el('dt',{},'Distance'),el('dd',{},data.distanceKm+' km'),el('dt',{},'Duration'),el('dd',{},data.durationMinutes+' min'),el('dt',{},'Notes'),el('dd',{class:'exercise-run-notes'},data.notes||'No notes'),...['effort','pain','fatigue'].filter(k=>data[k]!==undefined).flatMap(k=>[el('dt',{},k[0].toUpperCase()+k.slice(1)),el('dd',{},data[k])]));
   function rejectStaleReview(){if(item.version>=highestKnown(entry.value.id))return false;entry.value.needsReview=true;entry.error=Error('The saved run changed again. Your draft and original request are retained. Review the latest run before deciding.');choosing=false;replace(reviewContent,el('p',{role:'alert'},entry.error.message),button('Review latest saved run',()=>reviewSavedRun(entry,reviewContent),'quiet'),button('Download run draft',()=>exportEntry(entry),'text-button'));changed();return true;}
   async function choose(keepDraft){
    if(choosing||disposed||!document.querySelector('#dialog')?.contains(reviewContent))return;if(rejectStaleReview())return;choosing=true;const chosenToken=entry.value.token;
    const recovery={draft:structuredClone(entry.value),reviewedDraft:reviewed,current:item};if((await ctx.store.put('recovery:run:'+entry.value.id+':'+crypto.randomUUID(),recovery))===false){entry.error=Error('This device could not preserve both versions. Download the draft and keep this page open.');toast(entry.error.message);choosing=false;return;}
    if(disposed||entry.value.token!==chosenToken||!document.querySelector('#dialog')?.contains(reviewContent)){choosing=false;return;}if(rejectStaleReview())return;
    if(reviewed.pending)await ctx.store.remove('outbox:'+reviewed.pending.mutationId,reviewed.pending.mutationId);
    if(disposed||entry.value.token!==chosenToken||!document.querySelector('#dialog')?.contains(reviewContent)){choosing=false;return;}if(rejectStaleReview())return;
    const current=editable(item.data),chosen=keepDraft?{...current,distanceKm:entry.value.data.distanceKm,durationMinutes:entry.value.data.durationMinutes,notes:entry.value.data.notes}:current;
    entry.value={...entry.value,token:crypto.randomUUID(),version:item.version,data:chosen,displayDay:effectiveRunDay(item),pending:null,needsReview:false,dirty:keepDraft};entry.error=null;putInRecords(item);await persist(entry);if(disposed||!document.querySelector('#dialog')?.contains(reviewContent))return;document.querySelector('#dialog').close();await open(entry.value.data.date,item,entry.value.id);changed();
   }
   replace(reviewContent,el('h3',{},'Saved to LifeOS'),summary(item.data),el('h3',{},'Your draft'),summary(entry.value.data),el('p',{},'Both versions will be kept on this device before you choose. Using your draft leaves it ready for an explicit Save.'),button('Keep saved run',()=>choose(false),'quiet'),button('Use my draft',()=>choose(true)));modal('Review saved run',reviewContent,{onclose:changed});
  }catch(error){entry.error=error;paint(entry);}
 }
 async function open(day,record=null,draftId=null,{returnFocus}={}){
  const openedRoute=location.hash;
  if(disposed)return;let entry=draftId?entries.get(draftId):record?entries.get(record.id):[...entries.values()].find(e=>e.value.data.date===day&&!e.value.version);
  entry??=adopt({id:record?.id||crypto.randomUUID(),token:crypto.randomUUID(),version:record?.version||0,data:record?editable(record.data):{date:day,notes:''},displayDay:record?effectiveRunDay(record):day,dirty:false,pending:null});
  entry.returnFocus=returnFocus??entry.returnFocus;const focusTarget=entry.returnFocus;
  const value=entry.value,date=value.displayDay||value.data.date,distance=field('Distance, km',{type:'number',min:0,max:200,step:0.1,required:true,value:value.data.distanceKm??''}),minutes=field('Duration, minutes',{type:'number',min:0,max:3000,step:0.1,required:true,value:value.data.durationMinutes??''}),notes=field('Notes (optional)',{multiline:true,maxLength:5000,value:value.data.notes||''}),status=el('p',{role:'status'});
  const edit=()=>{entries.set(entry.value.id,entry);entry.value={...entry.value,token:crypto.randomUUID(),dirty:true,data:{...entry.value.data,distanceKm:distance.input.value===''?'':Number(distance.input.value),durationMinutes:minutes.input.value===''?'':Number(minutes.input.value),notes:notes.input.value}};entry.error=null;return persist(entry);};
  for(const input of [distance.input,minutes.input,notes.input])input.addEventListener('input',edit);
  const reviewButton=button('Review saved run',()=>reviewSavedRun(entry),'text-button');reviewButton.hidden=!entry.value.needsReview;
  const form=el('div',{class:'form-stack exercise-run-form'},el('p',{class:'exercise-run-date'},formatDate(date,true)),el('p',{class:'muted'},describe(date)),distance.node,minutes.node,notes.node,status,button('Save run',event=>busy(event.currentTarget,async()=>{
   if(entry.value.pending){await save(entry,form,focusTarget,openedRoute);return;}
   const km=Number(distance.input.value),min=Number(minutes.input.value);if(distance.input.value===''||minutes.input.value===''||!Number.isFinite(km)||!Number.isFinite(min)||km<0||km>200||min<0||min>3000||!distance.input.reportValidity()||!minutes.input.reportValidity()){status.textContent='Enter a distance from 0 to 200 km and a duration from 0 to 3000 minutes.';return;}
   if(!entry.value.pending)edit();await save(entry,form,focusTarget,openedRoute);
  })),reviewButton,button('Download run draft',()=>exportEntry(entry),'text-button'));
  entry.form=form;entry.status=status;entry.reviewButton=reviewButton;modal(record?'Edit run':'Log run',form,{onclose:changed});paint(entry);
 }
 return {open,reconcile,entries,exportEntry,dirty:()=>[...entries.values()].some(e=>e.value.dirty||e.value.pending||e.saving),async beforeLeave(){for(const entry of entries.values()){await entry.persistence;if((entry.value.dirty||entry.value.pending)&&!entry.durable){toast('Keep this page open or download your run draft before leaving.');return false;}}return true;},destroy(){disposed=true;}};
}
