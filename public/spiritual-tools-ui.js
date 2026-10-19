import {el,button,field,select,modal,busy,replace,toast} from './ui.js';import {stepSources,correctedSteps} from './spiritual-tools.js';import {flattenPrayer} from './prayer-tree.js';
export function editSmallSteps(ctx,entry,onSaved,{isCurrent=()=>true}={}){
 const body=el('div',{class:'form-stack'}),fields=correctedSteps(entry,ctx.records('devotional-step')).map(source=>({source,field:field('Application',{value:source.text,multiline:true,maxLength:1000}),version:ctx.records('devotional-step').find(r=>r.data.entryId===entry.id&&r.data.key===source.key)?.version??0}));
 for(const item of fields)body.append(el('details',{},el('summary',{},'Original from Arrow '+(item.source.arrow+1)),el('blockquote',{},item.source.original)),item.field.node);
 let closed=false,pending=false,closeSettled=false,dialog,children,onclose;
 const route=location.hash;
 const sameOwner=()=>isCurrent()&&document.querySelector('#dialog')===dialog&&location.hash===route&&body.isConnected&&dialog.onclose===onclose&&dialog.childNodes.length===children.length&&children.every((node,i)=>dialog.childNodes[i]===node);
 const current=()=>!closed&&dialog.open&&sameOwner();
 // A pending save belongs to this mounted child. Keep its button focusable and
 // reject repeat activation without disabling the native focused element.
 async function saveApplications(control){
  if(pending||!current())return;
  pending=true;control.setAttribute('aria-busy','true');control.setAttribute('aria-disabled','true');
  const steps=fields.map(f=>({key:f.source.key,original:f.source.original,corrected:f.field.input.value,version:f.version}));
  try{
   const result=await ctx.outbox.submit('/api/devotional-step',{entryId:entry.id,entryVersion:entry.version,steps});
   if(!current())return;
   if(result.pending){toast(result.reason);return;}
   fields.forEach(f=>{f.version=result.items.find(r=>r.data.key===f.source.key).version;});
   await ctx.refresh();
   if(!current())return;
   toast('Applications saved.');
   if(fields.every((f,i)=>f.field.input.value===steps[i].corrected)){
    closed=true;dialog.close();
    // Native close notifications are queued. Release this exact old anchor
    // before the return acquires another one; synchronous close already did it.
    if(!closeSettled&&!dialog.open&&dialog.onclose===onclose)onclose();
    // Closing can synchronously yield to a new popup. Returning to the message
    // needs both the original page and this exact, still closed child.
    const canReturn=()=>!dialog.open&&sameOwner()&&fields.every((f,i)=>f.field.input.value===steps[i].corrected);
    if(canReturn())await onSaved?.(canReturn);
   }
  }catch(error){if(current())toast(error.message);}
  finally{pending=false;control.removeAttribute('aria-busy');control.removeAttribute('aria-disabled');}
 }
 if(fields.length)body.append(button('Save applications',e=>saveApplications(e.currentTarget),'quiet'));else body.append(el('p',{},'No Small Step sentence is present in Arrow 5 or 6.'));
 dialog=modal('Application wording',body,{onclose:()=>{closed=true;closeSettled=true;}});children=[...dialog.childNodes];onclose=dialog.onclose;
}
export async function answeredPrayers(ctx){const data=(await ctx.request('/api/prayer-answers')).items,sections=ctx.records('prayer-list').flatMap(r=>r.data.sections??[]),requests=sections.flatMap(s=>flattenPrayer(s.nodes).filter(n=>n.type==='request'||n.entityKind==='person')),body=el('div',{class:'form-stack'});modal('Answered prayers',body);
 const paint=()=>replace(body,button('Link an answer',()=>{const request=select('Request',requests.map(n=>({value:n.id,label:n.entityLabel||n.text.slice(0,120)}))),day=field('Answer date',{type:'date',value:ctx.date()}),text=field('What happened?',{multiline:true,maxLength:3000}),session=select('Earlier session, optional',[{value:'',label:'No session selected'},...ctx.records('prayer-session').map(r=>({value:r.id,label:r.data.date||r.id}))]),form=el('div',{class:'form-stack'},request.node,day.node,text.node,session.node);form.append(button('Save answer',e=>busy(e.currentTarget,async()=>{const result=await ctx.outbox.submit('/api/prayer-answers',{id:crypto.randomUUID(),version:0,requestId:request.input.value,answeredOn:day.input.value,text:text.input.value,sessionId:session.input.value||null});if(result.pending){toast(result.reason);return;}data.unshift(result.item);paint();}),'quiet'));body.prepend(form);},'text-button'),...data.filter(r=>!r.data.archived).map(r=>el('section',{class:'practice-row'},el('h3',{},requests.find(n=>n.id===r.data.requestId)?.entityLabel||requests.find(n=>n.id===r.data.requestId)?.text||'Saved request'),el('p',{},r.data.answeredOn),el('p',{class:'detail-body'},r.data.text),r.data.sessionId?button('Open prayer session',()=>{document.querySelector('#dialog').close();ctx.go('prayer?view=journal&session='+encodeURIComponent(r.data.sessionId)+'&day='+encodeURIComponent(ctx.records('prayer-session').find(s=>s.id===r.data.sessionId)?.data.date||r.data.answeredOn));},'text-button'):null)));paint();}
