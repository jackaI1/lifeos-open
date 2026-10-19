import {el,replace,append,button,select,download} from './ui.js';
import {prepareCookingRecoveryDownload} from './cooking-recovery-download.js';
const labels={prepared:'Not sent',waiting:'Waiting',unknown:'Outcome not verified',review:'Needs review',confirmed:'Added','receipt-unretained':'Device save needed',conflict:'List changed',refused:'Not added'};
const activeList=(record,id)=>record?.kind==='reminder-list'&&record.id===id&&typeof id==='string'&&/^[\w-]{1,100}$/.test(id)&&Number.isSafeInteger(record.version)&&record.version>0&&record.data?.type==='grocery'&&record.data.archived===false&&typeof record.data.title==='string';
const clone=value=>structuredClone(value);
// The owner keeper owns effects; this view owns only explicit review and keyed
// presentation. Retiring this view never cancels or replaces an original POST.
export function createCookingGroceryReview({host,ctx,manager,getView,onIntent=()=>{}}){
 let retired=false,epoch=0,entry=null,review=null,cohort=null,preparing=null,sending=null,recoveryId=null,reviewToken=null;
 let state='closed',choices=new Map(),picker=null,save=null,add=null,localRetry=null,reviewButton=null,outcomeSummary=null;
 const panel=el('div',{class:'cooking-grocery-panel'}),notice=el('p',{class:'notice',role:'status',hidden:true}),rowsHost=el('div',{class:'cooking-grocery-outcomes'}),rows=new Map();
 const originalsBody=el('div',{}),originals=el('details',{class:'cooking-grocery-originals'},el('summary',{},'Saved grocery originals'),originalsBody),exports=new Map();
 const journal=()=>manager.groceries;
 const current=()=>!retired&&getView().eligible&&getView().entry===entry;
 const intent=()=>{epoch++;onIntent();};
 const message=text=>{if(!current())return;outcomeSummary=null;notice.hidden=!text;notice.textContent=text;};
 function witness(){const v=getView(),hash=location.hash,token=v.entry?.value.token,at=epoch;return()=>!retired&&getView().eligible&&getView().lease===v.lease&&getView().entry===v.entry&&v.entry?.value.token===token&&location.hash===hash&&epoch===at;}
 function ownedButton(label,activate,className){const view=getView(),boundEntry=view.entry,token=boundEntry?.value.token,lease=view.lease;let control;control=button(label,event=>{if(!current()||getView().entry!==boundEntry||getView().lease!==lease||boundEntry?.value.token!==token||!host.contains(control))return;return activate(event);},className);return control;}
 const request=path=>ctx.request(path,undefined,{refreshToday:false});
 function needed(){return entry?.value.ingredients.filter(i=>i.need&&i.text.trim())??[];}
 function related(){return [...(journal()?.intents.values()??[])].filter(e=>e.value.cook.cookId===entry?.value.cookId);}
 const prior=item=>related().filter(e=>e.value.ingredient.id===item.id||(e.value.ingredient.text===item.text&&e.value.destination.id===review?.list.id)).map(e=>journal().operation(e.value.operationId));
 const blocked=item=>prior(item).some(o=>['prepared','waiting','unknown','review','receipt-unretained'].includes(o.status));
 const duplicate=item=>review?.items.some(r=>r.data?.listId===review.list.id&&r.data.archived!==true&&r.data.title===item.text)||needed().some(other=>other.id!==item.id&&other.text===item.text)||prior(item).length>0;
 function selectedIds(){if(!review||review.token!==entry?.value.token||!current())return[];return needed().filter(i=>!blocked(i)&&(!duplicate(i)||choices.get(i.id)==='add')).map(i=>i.id);}
 function canPrepare(){const needs=needed();return current()&&state==='review'&&review?.token===entry.value.token&&!preparing&&!sending&&needs.length>0&&!needs.some(blocked)&&!needs.some(i=>duplicate(i)&&!['skip','add'].includes(choices.get(i.id)))&&selectedIds().length>0;}
 function preparedCurrent(){return current()&&cohort&&review?.token===entry.value.token&&review.epoch===epoch&&cohort.durable&&journal().cohorts.get(cohort.cohortId)?.durable;}
 function paintControls(){
  if(reviewToken&&reviewToken!==entry?.value.token&&state!=='closed'){intent();state='closed';review=null;cohort=null;save=null;add=null;localRetry=null;replace(panel);message('Cooking progress changed. Review the current ingredients again; every saved addition remains below.');}
  if(reviewButton)reviewButton.disabled=!needed().length||!!preparing||!!sending||!current();
  if(save)save.disabled=!canPrepare();
  if(add)add.disabled=!preparedCurrent()||!!sending||!!preparing||cohort.operationIds.some(id=>journal().operation(id)?.status!=='prepared');
  if(localRetry){localRetry.disabled=!!sending||!!preparing;localRetry.hidden=!!cohort?.durable&&[...journal().intents.values(),...journal().facts.values()].every(saved=>saved.durable);}
 }
 function exportOriginal(row){if(!current())return;const result=prepareCookingRecoveryDownload(row,{family:'J'});if(!result.ok){message(result.reason+' The original remains on this browser.');return;}try{download(result.filename,result.blob);}catch{message('The browser could not start the download. The original remains here.');}}
 function originalRow(saved,previous=null){
  const id=saved.value.operationId,boundEntry=entry,token=entry.value.token,lease=getView().lease,status=previous?.status??el('span',{class:'cooking-grocery-status'}),summary=previous?.summary??el('summary',{},el('span',{class:'cooking-original-text'},saved.value.ingredient.text),' · ',status),body=el('div',{}),details=previous?.details??el('details',{class:'cooking-grocery-outcome'});let confirmation=null;
  const owned=()=>current()&&getView().lease===lease&&entry===boundEntry&&boundEntry.value.token===token&&host.contains(details);
  const checked=el('input',{type:'checkbox'}),retry=ownedButton('Retry same addition',async()=>{
   if(!owned()||!checked.checked||!confirmation?.()||retry.disabled)return;const focused=document.activeElement===retry;intent();recoveryId=id;checked.checked=false;confirmation=null;const live=witness(),pending=journal().retryExact(id);retry.disabled=true;if(focused&&owned()&&(document.activeElement===retry||document.activeElement===document.body))summary.focus({preventScroll:true});
   try{await pending;}catch(error){if(live())message(error.message);}finally{if(live()&&recoveryId===id)recoveryId=null;if(current())paint();}
  },'quiet');checked.addEventListener('change',()=>{if(!owned()||!host.contains(checked))return;intent();recoveryId=checked.checked?id:null;confirmation=checked.checked?witness():null;paint();});
  const local=ownedButton('Retry grocery device save',async()=>{if(!owned()||local.disabled)return;intent();const live=witness();local.disabled=true;try{await journal().retryLocal();}catch(error){if(live())message(error.message);}finally{if(live())paint();}},'quiet');
  const originals=ownedButton('Download original addition',()=>exportOriginal({value:saved.value}),'text-button');
  append(body,el('p',{class:'muted'},'Original destination: '+saved.value.destination.title+' · saved revision '+saved.value.destination.version),el('p',{class:'muted cooking-grocery-exact'},'The same saved request and identities are used on retry. A timeout does not prove whether an item was added.'),el('label',{class:'check'},checked,'I reviewed this original addition and its destination'),el('div',{class:'actions'},retry,local,originals));
  const before=document.activeElement,focused=previous?.body.contains(before);replace(details,summary,body);if(focused&&current()&&(document.activeElement===before||document.activeElement===document.body))summary.focus({preventScroll:true});
  return{details,status,summary,checked,retry,local,body,saved,token,lease,boundEntry,consented:()=>owned()&&confirmation?.()===true};
 }
 function paint(){
  if(!current())return;const j=journal();if(!j)return;
  if(outcomeSummary){const {operationIds,title}=outcomeSummary,confirmed=operationIds.filter(id=>j.operation(id)?.status==='confirmed').length,total=operationIds.length;notice.hidden=false;notice.textContent=confirmed===total?'Added '+confirmed+' to '+title+'.':confirmed+' of '+total+' added. Review the saved outcomes below; no uncertain item is sent again automatically.';}
  for(const saved of related()){
   const id=saved.value.operationId;let row=rows.get(id);if(!row){row=originalRow(saved);rows.set(id,row);append(rowsHost,row.details);}else if(row.token!==entry.value.token||row.lease!==getView().lease||row.boundEntry!==entry){row=originalRow(saved,row);rows.set(id,row);}
   const op=j.operation(id);row.status.textContent=labels[op.status]??'Needs review';if(row.checked.checked&&!row.consented()){row.checked.checked=false;if(recoveryId===id)recoveryId=null;}row.retry.disabled=!row.checked.checked||!row.consented()||op.requestPending||['confirmed','receipt-unretained','review','waiting'].includes(op.status)||!!sending||!!preparing;
   row.retry.hidden=['confirmed','receipt-unretained','review'].includes(op.status);row.checked.parentNode.hidden=row.retry.hidden;
   row.local.hidden=saved.durable&&[...j.facts.values()].filter(f=>f.value.operationId===id).every(f=>f.durable);row.local.disabled=!!sending||!!preparing;
  }
  const ids=new Set(related().map(saved=>saved.value.operationId));let cohortNumber=0,factNumber=0;
  const retained=[...j.cohorts.values()].filter(saved=>saved.value.operationIds.some(id=>ids.has(id))).map(saved=>({key:'cohort:'+saved.value.cohortId,saved,label:'Download saved grocery selection'+(++cohortNumber===1?'':' '+cohortNumber)}));
  retained.push(...[...j.facts.values()].filter(saved=>ids.has(saved.value.operationId)).map(saved=>({key:'fact:'+saved.value.factId,saved,label:'Download grocery fact '+(++factNumber)})));
  const before=document.activeElement,focusedOriginal=[...exports].find(([,saved])=>saved.control===before)?.[0];let exportChanged=false;
  for(const record of retained){const old=exports.get(record.key);if(!old||old.token!==entry.value.token||old.lease!==getView().lease||old.entry!==entry){const control=ownedButton(record.label,()=>exportOriginal({value:record.saved.value}),'text-button');exports.set(record.key,{control,token:entry.value.token,lease:getView().lease,entry});exportChanged=true;}}
  if(exportChanged){replace(originalsBody,...[...exports.values()].map(saved=>saved.control));if(focusedOriginal&&current()&&(document.activeElement===before||document.activeElement===document.body))exports.get(focusedOriginal)?.control.focus({preventScroll:true});}
  originals.hidden=exports.size===0;rowsHost.hidden=rows.size===0;paintControls();
 }
 function reviewRows(){
  const content=el('div',{class:'cooking-grocery-lines'});
  for(const item of needed()){
   const line=el('div',{class:'cooking-grocery-line'},el('p',{class:'cooking-original-text'},item.text));
   if(blocked(item))append(line,el('p',{class:'notice'},'A saved addition already needs review. Use its original below; a new request will not be made.'));
   else if(duplicate(item)){
    const choice=select('Matching line already exists', [{value:'',label:'Choose what to do'},{value:'skip',label:'Skip this line'},{value:'add',label:'Add another unchanged line'}]);choice.input.classList.add('cooking-grocery-duplicate');choice.input.value=choices.get(item.id)??'';
    choice.input.addEventListener('change',()=>{if(!current()||review.token!==entry.value.token)return;intent();choices.set(item.id,choice.input.value);review.epoch=epoch;paintControls();});append(line,choice.node);
   }
   append(content,line);
  }return content;
 }
 async function chooseList(id){
  if(!current())return;intent();reviewToken=entry.value.token;const live=witness();review=null;cohort=null;choices=new Map();state='loading';replace(panel,picker.node,el('p',{class:'muted'},'Checking this grocery list…'),closeButton());paintControls();
  if(!id){state='select';replace(panel,picker.node,closeButton());return;}
  try{
   const result=await request('/api/records/reminder-list/'+encodeURIComponent(id));if(!live())return;if(!activeList(result?.item,id))throw Error('This grocery list could not be verified. Choose an active saved list.');
   const items=[];let complete=false;for(let page=0;page<5;page++){
    const result=await request('/api/records/reminder?limit=100&offset='+page*100);if(!live())return;
    if(!Array.isArray(result?.items)||result.items.length>100)throw Error('The existing grocery lines could not be verified.');items.push(...result.items);if(result.items.length<100){complete=true;break;}
   }
   if(!live())return;review={list:clone(result.item),items:clone(items),token:entry.value.token,epoch};state='review';
   save=ownedButton('Save grocery review',()=>prepare(),'quiet');add=null;localRetry=null;
   replace(panel,picker.node,el('p',{class:'muted'},complete?'Exact matching lines checked. Quantities and wording are kept unchanged.':'Only the first 500 saved reminders were checked. Review this list in Reminders too; other matches may exist.'),reviewRows(),el('div',{class:'actions'},save,closeButton()));message('');paint();
  }catch(error){if(live()){state='select';save=null;add=null;replace(panel,picker.node,closeButton());message(error.status===404?'This grocery list is no longer available. Its original was not recreated.':error.message);}}
 }
 function closeButton(){const control=ownedButton('Close grocery review',()=>{if(!current())return;const focused=document.activeElement===control;intent();state='closed';review=null;cohort=null;save=null;add=null;localRetry=null;replace(panel);message('');if(focused&&(document.activeElement===control||document.activeElement===document.body))reviewButton.focus({preventScroll:true});},'text-button');return control;}
 async function discover(){
  if(!current()||state==='discovering'||preparing||sending)return;const focused=document.activeElement===reviewButton,origin=reviewButton;intent();reviewToken=entry.value.token;const live=witness();state='discovering';review=null;cohort=null;save=null;add=null;replace(panel,el('p',{class:'muted'},'Finding saved grocery lists…'),closeButton());message('');
  try{
   const lists=[];let complete=false;for(let page=0;page<3;page++){
    const result=await request('/api/records/reminder-list?limit=100&offset='+page*100);if(!live())return;if(!Array.isArray(result?.items)||result.items.length>100)throw Error('The saved grocery lists could not be verified.');lists.push(...result.items.filter(r=>activeList(r,r?.id)));if(result.items.length<100){complete=true;break;}
   }
   if(!live())return;state='select';picker=select('Grocery list',[{value:'',label:'Choose a saved grocery list'},...lists.map(r=>({value:r.id,label:r.data.title}))]);picker.input.classList.add('cooking-grocery-list');picker.input.value='';picker.input.addEventListener('change',()=>chooseList(picker.input.value));
   replace(panel,lists.length?picker.node:el('p',{class:'muted'},'No active saved grocery lists were found. Create one in Reminders, then review again.'),!complete?el('p',{class:'notice'},'Only the first 300 lists were checked. Open Reminders if yours is missing.'):null,closeButton());if(focused&&(document.activeElement===origin||document.activeElement===document.body))(lists.length?picker.input:reviewButton).focus({preventScroll:true});
  }catch(error){if(live()){state='closed';replace(panel,closeButton());message(error.message);}}
 }
 async function prepare(){
  if(!canPrepare())return;const originalControl=save,focused=document.activeElement===save;intent();review.epoch=epoch;const live=witness(),ids=selectedIds(),snapshot=review,original=entry;state='preparing';paintControls();
  preparing=journal().prepare(original,ids,snapshot.list,{});
  try{const saved=await preparing;if(!live())return;cohort=saved;state='prepared';save=null;add=ownedButton('Add '+saved.operationIds.length+' to groceries',()=>send(),'quiet');localRetry=ownedButton('Retry grocery device save',()=>retryLocal(),'quiet');
   replace(panel,el('p',{class:'muted'},'Selection saved for '+snapshot.list.data.title+'. Review the outcomes below.'),el('div',{class:'actions'},add,localRetry,closeButton()));message(saved.durable?'':'Device save needed before adding. Your original reviewed selection remains below.');
   if(focused&&(document.activeElement===originalControl||document.activeElement===document.body))(saved.durable?add:localRetry).focus({preventScroll:true});
  }catch(error){if(live()){state='review';message(error.message);}}finally{preparing=null;if(current())paint();}
 }
 async function retryLocal(){
  if(!current()||preparing||sending)return;intent();if(review)review.epoch=epoch;const live=witness();preparing=journal().retryLocal();
  try{await preparing;if(live()&&cohort){cohort={...cohort,durable:journal().cohorts.get(cohort.cohortId)?.durable===true};message(cohort.durable?'':'Device save is still not verified. Keep the originals.');}}catch(error){if(live())message(error.message);}finally{preparing=null;if(current())paint();}
 }
 async function send(){
  if(!preparedCurrent()||sending||preparing||cohort.operationIds.some(id=>journal().operation(id)?.status!=='prepared'))return;const origin=add,focused=document.activeElement===origin;intent();review.epoch=epoch;const live=witness(),original=cohort;sending=journal().sendPrepared(original);paintControls();if(focused&&current()&&(document.activeElement===origin||document.activeElement===document.body))rows.get(original.operationIds[0])?.details.querySelector('summary')?.focus({preventScroll:true});
  try{await sending;if(live())outcomeSummary={operationIds:[...original.operationIds],title:review.list.data.title};}catch(error){if(live())message(error.message);}finally{sending=null;if(current())paint();}
 }
 function render(value){
  if(retired)return;intent();entry=value;review=null;cohort=null;reviewToken=null;recoveryId=null;choices=new Map();state='closed';picker=null;save=null;add=null;outcomeSummary=null;rows.clear();exports.clear();replace(panel);replace(rowsHost);replace(originalsBody);notice.hidden=true;
  reviewButton=button('Review groceries',()=>discover(),'text-button');reviewButton.disabled=!needed().length;
  replace(host,reviewButton,panel,notice,rowsHost,originals);paint();
 }
 return{render,paint,retire(){retired=true;intent();},get epoch(){return epoch;},get recoveryId(){return recoveryId;}};
}
