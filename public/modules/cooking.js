import {CookingHelp} from '../cooking-help-journal.js';
import {createCookingHelpReview} from '../cooking-help-review.js';
import {CookingSessions} from '../local-cooking-sessions.js';
import {CookingTimers} from '../cooking-timer-binding.js';
import {CookingCustody} from '../cooking-custody.js';
import {CookingGroceries} from '../cooking-grocery-journal.js';
import {createCookingGroceryReview} from '../cooking-grocery-review.js';
import {prepareCookingRecoveryDownload} from '../cooking-recovery-download.js';
import {timerReading,formatTimer} from '../task-time.js';
import {el,replace,append,button,heading,field,busy,empty,toast,download,formatDate,formatTime} from '../ui.js';

const managers=new WeakMap(),route=id=>'reminders?view=cooking'+(id?'&session='+id:'');
function manager(ctx){
 const owner=ctx.state.session.email.trim().toLowerCase();let owners=managers.get(ctx);if(!owners){owners=new Map();managers.set(ctx,owners);}
 if(!owners.has(owner)){
  const listeners=new Set(),changed=()=>listeners.forEach(fn=>fn()),sessions=new CookingSessions({store:ctx.store,environment:'beta',owner,onChange:changed}),value={sessions,listeners,groceries:null,help:null,view:null,ready:null};owners.set(owner,value);
  value.ready=sessions.initialize().then(async()=>{value.groceries=await new CookingGroceries({sessions,request:(path,options)=>ctx.request(path,options,{refreshToday:false}),getScope:()=>{
   const view=value.view,current=view?.read();return{environment:current?.eligible?ctx.state.session?.environment:null,owner:ctx.state.session?.email,entry:current?.entry,routeHash:location.hash,viewLease:view?.lease,groceryReviewEpoch:current?.groceryEpoch,recoveryId:current?.recoveryId};
  },onChange:changed}).initialize();value.help=await new CookingHelp({sessions,request:(path,options)=>{const {refreshToday,...requestOptions}=options??{};return ctx.request(path,requestOptions,{refreshToday:false});},getScope:()=>{const view=value.view,current=view?.read();return{environment:current?.eligible?ctx.state.session?.environment:null,owner:ctx.state.session?.email,entry:current?.entry,stepId:current?.stepId,routeHash:location.hash,viewLease:view?.lease,rawUnsaved:current?.rawUnsaved};},onChange:changed}).initialize();return value;});
 }return owners.get(owner);
}
export function mount(root,ctx){
 if(ctx.state.session?.environment!=='beta'||typeof ctx.state.session.email!=='string'){
  replace(root,heading('Cooking'),empty('Open the local workspace to use recipes and cooking progress.'));return{ready:Promise.resolve(),destroy(){}};
 }
 const m=manager(ctx),sessions=m.sessions,owner=ctx.state.session.email.trim().toLowerCase(),authenticatedOwner=ctx.state.session.email;let disposed=false,selected=null,opening=false,rawUnsaved=false;
 const lease=Object.freeze({});
 const eligible=()=>!disposed&&m.view?.lease===lease&&ctx.state.session?.environment==='beta'&&ctx.state.session?.email===authenticatedOwner;
 const library=el('section',{class:'cooking-library'}),workspace=el('section',{class:'cooking-workspace'}),saveStatus=el('p',{class:'cooking-save-status',role:'status'}),clockHost=el('div',{class:'cooking-clock'}),historyHost=el('div',{class:'cooking-history'}),downloadStatus=el('p',{class:'notice',role:'status',hidden:true});
 const clocks=new CookingTimers({sessions,timers:ctx.timers,getSelection:()=>selected,routeHash:()=>location.hash,onChange:()=>paintClock()});
 const groceryHost=el('section',{class:'cooking-groceries','aria-label':'Grocery review'});
 const grocery=createCookingGroceryReview({host:groceryHost,ctx,manager:m,getView:()=>({eligible:eligible(),entry:selected,lease})});
 const helpHost=el('section',{class:'cooking-help','aria-label':'Selected step help'}),helpReview=createCookingHelpReview({host:helpHost,manager:m,getView:()=>({eligible:eligible(),entry:selected,stepId:position(selected)?.stepId,lease}),onAdopt:result=>{if(!eligible())return;const focused=helpHost.contains(document.activeElement);selected=result.entry;renderEntry();paintHistory();if(focused&&document.activeElement===document.body)helpHost.querySelector('summary')?.focus({preventScroll:true});void result.persistence.then(()=>{if(eligible()){paintSave();paintHistory();paintClock();helpReview.paint();}});}});
 m.view={lease,read:()=>({eligible:eligible(),entry:selected,stepId:selected?position(selected).stepId:null,rawUnsaved,groceryEpoch:grocery.epoch,recoveryId:grocery.recoveryId})};
 const title=entry=>typeof entry.value.source.data.title==='string'?entry.value.source.data.title:'Saved recipe';
 const status=entry=>entry.error||(sessions.cachedRetained(entry)?'Saved on this device · Original recipe unchanged':'Saving on this device…');
 function paintSave(){if(disposed||!selected)return;saveStatus.textContent=rawUnsaved?'Keep this page open. Review the timer value before leaving.':status(selected);}
 function position(entry){return entry?.value.position??{stepId:entry?.value.steps[0]?.id??null,mode:'prepare'};}
 function stepIndex(entry){return entry.value.steps.findIndex(step=>step.id===position(entry).stepId);}
 function progressLabel(entry){const index=stepIndex(entry);return(index>=0?'Step '+(index+1)+' of '+entry.value.steps.length:'No step selected')+' · '+(position(entry).mode==='follow'?'Following':'Preparing');}
 function paintHistory(){
  if(disposed)return;
  const leaves=sessions.leaves(),ids=[...new Set([...sessions.entries.values()].map(entry=>entry.value.cookId))];
  const sessionName=entry=>title(entry)+' · Session '+(ids.indexOf(entry.value.cookId)+1);
  replace(historyHost,el('h2',{},'Cooking progress'),leaves.length?leaves.map(entry=>el('div',{class:'cooking-history-row'},
   button('Continue '+sessionName(entry),()=>openEntry(entry),'text-button'),
   el('p',{class:'muted'},progressLabel(entry)),
   el('p',{class:'muted'},formatDate(entry.value.updatedAt)+' at '+formatTime(entry.value.updatedAt)+' · '+status(entry)),
   button('Download this progress',()=>exportEntry(entry),'text-button'))):el('p',{class:'muted'},'Your recipe, steps and notes will be kept here on this browser.'));
  const parents=[...sessions.entries.values()].filter(entry=>!leaves.includes(entry));
  if(parents.length)append(historyHost,el('details',{},el('summary',{},'Earlier saved versions · '+parents.length),parents.map(entry=>button(sessionName(entry)+' · '+progressLabel(entry),()=>openEntry(entry),'text-button'))));
  append(historyHost,recoverySection());
 }
 function exportRow(row,family,filename){
  if(!eligible())return;
  const result=prepareCookingRecoveryDownload(row,{family});
  if(!result.ok){downloadStatus.hidden=false;downloadStatus.textContent=result.reason+' The original remains on this browser. Keep this page open if you have unsaved writing.';return;}
  try{download(filename??result.filename,result.blob);downloadStatus.hidden=true;}catch{downloadStatus.hidden=false;downloadStatus.textContent='The browser could not start the download. Your original remains here; keep this page open.';}
 }
 function recoverySection(){
  const families=[['F','cooking',sessions.recoveries],['I','timer',clocks.recoveries],['J','grocery',m.groceries?.recoveries??[]],['H','help',m.help?.recoveries??[]]],count=families.reduce((total,[,,rows])=>total+rows.length,0);
  return count?el('details',{},el('summary',{},'Other retained originals · '+count),el('p',{class:'muted'},'These originals could not be opened. Each can be downloaded separately when its complete value can be preserved. The originals remain unchanged.'),families.flatMap(([family,name,rows])=>rows.map((row,index)=>button('Download retained '+name+' original '+(index+1),()=>exportRow(row,family),'text-button')))):null;
 }
 function exportEntry(entry){
  if(!eligible())return;
  exportRow({value:{session:entry.value,...(entry===selected&&rawUnsaved?{unretainedTimerInput:workspace.querySelector('.cooking-minutes')?.value}:{}),clocks:clocks.forEntry(entry),help:m.help?.exportRecovery()??null}},'F','lifeos-cooking-'+entry.value.cookId+'.json');
 }
 function edit(patch){if(!selected||!eligible())return Promise.resolve();const previous=selected;selected=sessions.beginEdit(selected);if(selected!==previous)grocery.render(selected);const entry=selected;return sessions.edit(entry,patch).then(()=>{paintSave();paintHistory();paintClock();grocery.paint();}).catch(error=>{saveStatus.textContent=error.message;});}
 async function safe(final=false){const saved=await(final?custody.finalBeforeLeave():custody.beforeLeave());if(!saved)toast(rawUnsaved?'Review the timer value or download your cooking progress before leaving.':'Keep this page open or download the cooking progress before leaving. Cooking progress or a help original has not been verified on this device.');return saved;}
 async function openEntry(entry){if(opening||!eligible()||!await safe()||!eligible())return;selected=entry;rawUnsaved=false;renderEntry();await ctx.go(route(entry.value.cookId));}
 async function chooseRecipe(record){if(opening||!eligible()||!await safe()||!eligible())return;opening=true;
  try{const result=await ctx.request('/api/records/meal/'+encodeURIComponent(record.id));if(result.item?.kind!=='meal'||result.item.id!==record.id||!Number.isSafeInteger(result.item.version)||result.item.version<1)throw Error('This recipe could not be verified. Its original has not changed.');
   if(!eligible())return;selected=await sessions.create({kind:'meal',id:result.item.id,version:result.item.version,data:result.item.data});renderEntry();if(sessions.cachedRetained(selected))await ctx.go(route(selected.value.cookId));
  }catch(error){toast(error.status===404?'This recipe is no longer available. Choose another saved recipe.':error.message);}finally{opening=false;}
 }
 function renderLibrary(){if(disposed)return;library.hidden=!!selected;const recipes=ctx.records('meal').filter(record=>!record.data?.archived);replace(library,el('h2',{},'Saved recipes'),recipes.length?recipes.map(record=>el('div',{class:'cooking-recipe-row'},button(record.data.title||'Untitled recipe',()=>chooseRecipe(record),'text-button'),el('p',{class:'muted'},record.data.slot==='recipe'?'Recipe':'Saved meal'))):empty('No saved recipes are available yet. Your existing recipes will appear here; this preview does not invent or replace them.'),historyHost);paintHistory();}
 function stepPatch(step,patch){const next={...step,...patch};return edit({steps:selected.value.steps.map(item=>item.id===step.id?next:item)});}
 async function clockAction(event,task){
  const original=event.currentTarget,focused=original===document.activeElement,id=original.getAttribute('data-clock-id');
  await busy(original,task);
  // Disabling/replacing the original action can move browser focus to body.
  // Repair that transition only; never steal focus from newer writing elsewhere.
  if(focused&&eligible()&&(document.activeElement===original||document.activeElement===document.body||clockHost.contains(document.activeElement)))paintClock({restoreFocus:{id}});
 }
 function paintClock({restoreFocus=null}={}){
  if(disposed||!selected)return;
  const focused=document.activeElement,restore=!!restoreFocus||focused===clockHost||clockHost.contains(focused),focusedId=restoreFocus?.id??focused?.getAttribute?.('data-clock-id');
  const othersOpen=clockHost.querySelector('.cooking-other-timers')?.open===true,finishedOpen=clockHost.querySelector('.cooking-finished-timers')?.open===true;
  const step=selected.value.steps[stepIndex(selected)],all=clocks.forEntry(selected).filter(value=>!clocks.cancellations.has(value.clockId));
  const unfinished=all.filter(value=>ctx.timers.rows.get(value.clockId)?.data.state!=='finished'),current=unfinished.filter(value=>value.step.id===step?.id),others=unfinished.filter(value=>value.step.id!==step?.id),finished=all.filter(value=>ctx.timers.rows.get(value.clockId)?.data.state==='finished');
  replace(clockHost);clockHost.setAttribute('tabindex','-1');clockHost.setAttribute('role','group');clockHost.setAttribute('aria-label','Cooking timers');
  function timerRow(association,primary=false){
   const row=ctx.timers.rows.get(association.clockId),index=selected.value.steps.findIndex(item=>item.id===association.step.id),name=index>=0?'Step '+(index+1):'Earlier step';
   if(!row)return el('div',{},el('p',{class:'notice'},name+' timer needs review. Its original instruction is retained.'),button('Review timers',()=>ctx.timers.open(),'quiet'));
   const state=el('p',{class:'cooking-timer-state'},name+' · '+(row.data.state==='running'?'Running':row.data.state==='paused'?'Paused':'Finished'));
   const remaining=el('output',{class:'cooking-timer-remaining','aria-live':'off'}),spent=el('output',{class:'cooking-timer-spent','aria-live':'off'}),remainingLabel=el('span',{class:'cooking-timer-remaining-label'});
   const reading=el('div',{class:'cooking-timer-reading','data-clock-id':row.id,'data-timer-state':row.data.state},el('span',{},remaining,' ',remainingLabel),el('span',{},spent,' spent'));
   const paint=()=>{const latest=ctx.timers.rows.get(row.id);if(!latest)return;const value=timerReading(latest.data);remaining.textContent=formatTimer(value.display);remainingLabel.textContent=value.overtime?'overtime':'remaining';spent.textContent=formatTimer(value.total);};paint();
   const actions=el('div',{class:'actions'});
   if(row.data.state!=='finished'){
    const toggle=button(row.data.state==='running'?(primary?'Pause step timer':'Pause '+name+' timer'):(primary?'Resume original timer':'Resume '+name+' timer'),e=>clockAction(e,async()=>{if(!eligible())return;const latest=ctx.timers.rows.get(row.id);if(!latest)return;await ctx.timers.update(row.id,latest.data.state==='running'?'pause':'resume');paintClock();}),'quiet');toggle.setAttribute('data-clock-id',row.id);toggle.setAttribute('data-cooking-clock-action','toggle');
    const finish=button(primary?'Finish timer':'Finish '+name+' timer',e=>clockAction(e,async()=>{if(!eligible())return;await ctx.timers.update(row.id,'finish');paintClock();}),'text-button');finish.setAttribute('data-clock-id',row.id);finish.setAttribute('data-cooking-clock-action','finish');append(actions,toggle,finish);
   }
   return el('div',{class:'cooking-timer-row'},state,reading,el('p',{class:'muted'},'Original instruction: '+association.step.text),actions);
  }
  current.forEach(value=>append(clockHost,timerRow(value,true)));
  if(step&&!current.length){
   const start=button('Start step timer',e=>clockAction(e,async()=>{if(!eligible())return;await clocks.start(selected,step.id);paintClock();}));start.setAttribute('data-cooking-clock-action','start');
   start.disabled=!eligible()||!step.reviewed||step.done||!step.text.trim()||!step.minutes||!sessions.cachedRetained(selected)||rawUnsaved||clocks.pending.size>0;
   append(clockHost,start,el('p',{class:'muted'},step.minutes?'Starts only when you click. Leaving this page pauses it.':'Add timer minutes and review the step to use a timer.'));
  }
  if(others.length)append(clockHost,el('details',{class:'cooking-other-timers',open:othersOpen},el('summary',{},'Other timers · '+others.length),others.map(value=>timerRow(value))));
  if(finished.length)append(clockHost,el('details',{class:'cooking-finished-timers',open:finishedOpen},el('summary',{},'Finished timers · '+finished.length),finished.map(value=>timerRow(value))));
  if(all.length)append(clockHost,el('p',{class:'muted'},'Finishing a timer does not mark a step done.'));
  if(restore){const buttons=Array.from(clockHost.querySelectorAll('button')),next=buttons.find(node=>node.getAttribute('data-clock-id')===focusedId&&node.getAttribute('data-cooking-clock-action')==='toggle')||buttons.find(node=>node.getAttribute('data-cooking-clock-action')==='start')||buttons.find(node=>node.getAttribute('data-cooking-clock-action')==='toggle');(next&&!next.disabled?next:clockHost).focus({preventScroll:true});}
 }
 function tickClocks(){
  for(const reading of clockHost.querySelectorAll('.cooking-timer-reading')){const row=ctx.timers.rows.get(reading.getAttribute('data-clock-id'));if(!row)continue;
   if(reading.getAttribute('data-timer-state')!==row.data.state){paintClock();return;}
   const value=timerReading(row.data);reading.querySelector('.cooking-timer-remaining').textContent=formatTimer(value.display);reading.querySelector('.cooking-timer-remaining-label').textContent=value.overtime?'overtime':'remaining';reading.querySelector('.cooking-timer-spent').textContent=formatTimer(value.total);
  }
 }
 function changePosition(next,{focus='.cooking-step-heading'}={}){
  if(!eligible())return Promise.resolve();
  if(rawUnsaved){toast('Review the timer value before changing steps or mode.');return Promise.resolve();}
  // Adopt the new local position before rendering. A late save only updates its
  // status, so it cannot replace a field the user has started writing in.
  const saving=edit({position:next});renderEntry();workspace.querySelector(focus)?.focus({preventScroll:true});return saving;
 }
 function renderEntry({revealIngredients=false}={}){
  if(disposed||!selected)return;
  const ingredientsOpen=revealIngredients||workspace.querySelector('.cooking-ingredients')?.open===true;
  const source=selected.value.source.data,sourceText=typeof source.recipe==='string'?source.recipe:JSON.stringify(source,null,2);
  const currentStep=stepIndex(selected),mode=position(selected).mode,following=mode==='follow',step=selected.value.steps[currentStep];workspace.hidden=false;
  const notes=field('Cooking notes',{multiline:true,value:selected.value.notes,placeholder:'Changes for this cooking session'});
  notes.input.addEventListener('input',()=>{void edit({notes:notes.input.value});paintSave();});
  const prepare=button('Prepare',()=>changePosition({...position(selected),mode:'prepare'},{focus:'.cooking-mode-prepare'}),'quiet');
  const follow=button('Follow',()=>changePosition({...position(selected),mode:'follow'},{focus:'.cooking-mode-follow'}),'quiet');
  prepare.classList.add('cooking-mode-prepare');follow.classList.add('cooking-mode-follow');prepare.setAttribute('aria-pressed',String(!following));follow.setAttribute('aria-pressed',String(following));
  const modes=el('div',{class:'cooking-modes',role:'group','aria-label':'Cooking view'},prepare,follow);
  const steps=el('section',{class:'cooking-steps'});
  const add=button('Add step',()=>{
   if(!eligible())return;
   if(rawUnsaved){toast('Review the timer value before changing steps.');return;}
   const value={id:crypto.randomUUID(),text:'',reviewed:false,done:false,minutes:null};
   const saving=edit({steps:[...selected.value.steps,value],position:{stepId:value.id,mode:'prepare'}});renderEntry();workspace.querySelector('.cooking-instruction')?.focus({preventScroll:true});return saving;
  },'quiet');
  if(step){
   const move=next=>changePosition({stepId:selected.value.steps[next].id,mode:position(selected).mode});
   const previous=button('Previous step',()=>move(currentStep-1),'quiet'),next=button('Next step',()=>move(currentStep+1),'quiet');
   previous.disabled=currentStep===0;next.disabled=currentStep===selected.value.steps.length-1;
   append(steps,el('div',{class:'cooking-step-navigation'},el('h2',{class:'cooking-step-heading',tabindex:'-1'},'Step '+(currentStep+1)+' of '+selected.value.steps.length),el('div',{class:'actions'},previous,next)));
   const done=el('input',{type:'checkbox',checked:step.done});
   done.addEventListener('change',()=>{void stepPatch(selected.value.steps.find(item=>item.id===step.id),{done:done.checked}).then(paintClock);});
   if(following){
    append(steps,el('p',{class:'cooking-follow-instruction'},step.text||'This step has no instruction yet. Prepare it before cooking.'),clockHost,
     el('label',{class:'check'},done,'This step is done'),button('Edit this step',()=>changePosition({...position(selected),mode:'prepare'},{focus:'.cooking-instruction'}),'text-button'));
   }else{
    const instruction=field('Step instruction',{multiline:true,value:step.text}),minutes=field('Timer minutes',{type:'number',min:1,max:240,step:1,value:step.minutes??''}),reviewed=el('input',{type:'checkbox',checked:step.reviewed});
    instruction.input.classList.add('cooking-instruction');minutes.input.classList.add('cooking-minutes');
    instruction.input.addEventListener('input',()=>{reviewed.checked=false;void stepPatch(selected.value.steps.find(item=>item.id===step.id),{text:instruction.input.value,reviewed:false}).then(paintClock);paintSave();});
    minutes.input.addEventListener('input',()=>{const value=minutes.input.value===''?null:Number(minutes.input.value);rawUnsaved=value!==null&&(!Number.isInteger(value)||value<1||value>240);reviewed.checked=false;if(!rawUnsaved)void stepPatch(selected.value.steps.find(item=>item.id===step.id),{minutes:value,reviewed:false}).then(paintClock);paintSave();paintClock();});
    reviewed.addEventListener('change',()=>{if(rawUnsaved){reviewed.checked=false;return;}void stepPatch(selected.value.steps.find(item=>item.id===step.id),{reviewed:reviewed.checked}).then(paintClock);});
    append(steps,instruction.node,el('div',{class:'cooking-step-options'},minutes.node,el('label',{class:'check'},reviewed,'I reviewed this step and its timer')),clockHost,el('label',{class:'check'},done,'This step is done'),add);
   }
  }else{
   append(steps,el('h2',{class:'cooking-step-heading',tabindex:'-1'},selected.value.steps.length?'Choose a step':'Your steps'),
    el('p',{class:'muted'},selected.value.steps.length?'Choose where to continue. Your saved steps remain unchanged.':'Keep the original recipe below. Add the steps you want to follow, without changing the original.'));
   if(!following)append(steps,add);
   else if(!selected.value.steps.length)append(steps,button('Prepare your steps',()=>changePosition({...position(selected),mode:'prepare'}),'quiet'));
  }
  if(selected.value.steps.length)append(steps,el('details',{class:'cooking-step-picker'},el('summary',{},'All steps · '+selected.value.steps.length),selected.value.steps.map((item,index)=>{
   const select=button('Step '+(index+1)+(item.done?' · Done':'')+(item.text?' · '+item.text:' · No instruction'),()=>changePosition({stepId:item.id,mode:position(selected).mode}),'text-button');
   if(item.id===step?.id)select.setAttribute('aria-current','step');return select;
  })));
  const ingredients=el('details',{class:'cooking-ingredients',open:ingredientsOpen},el('summary',{},'Ingredients to review'));
  append(ingredients,el('p',{class:'muted'},'These marks are local preparation only. Keep quantities and wording exactly as written; no grocery list or order changes when you check Need.'));
  for(const item of selected.value.ingredients){
   if(following){append(ingredients,el('div',{class:'cooking-ingredient-row'},el('p',{class:'cooking-original-text'},item.text),el('span',{class:'muted'},item.need?'Marked Need':'Not marked Need')));continue;}
   const line=field('Ingredient',{value:item.text}),need=el('input',{type:'checkbox',checked:item.need});
   line.input.addEventListener('input',()=>{void edit({ingredients:selected.value.ingredients.map(current=>current.id===item.id?{...current,text:line.input.value}:current)});});
   need.addEventListener('change',()=>{void edit({ingredients:selected.value.ingredients.map(current=>current.id===item.id?{...current,need:need.checked}:current)});});
   append(ingredients,el('div',{class:'cooking-ingredient-row'},line.node,el('label',{class:'check'},need,'Need')));
  }
  if(!following)append(ingredients,button('Add ingredient',()=>{
   if(!eligible())return;
   if(rawUnsaved){toast('Review the timer value before changing ingredients.');return;}
   const saving=edit({ingredients:[...selected.value.ingredients,{id:crypto.randomUUID(),text:'',need:false}]});renderEntry({revealIngredients:true});workspace.querySelectorAll('.cooking-ingredient-row')[selected.value.ingredients.length-1]?.querySelector('input')?.focus({preventScroll:true});return saving;
  },'quiet'));
  replace(workspace,el('div',{class:'cooking-entry-heading'},el('h2',{},title(selected)),button('Back to recipes',async()=>{if(await safe()){selected=null;workspace.hidden=true;ctx.go(route());renderLibrary();}},'text-button')),
   saveStatus,modes,steps,helpHost,
   el('details',{class:'cooking-original',open:!step||!step.text.trim()},el('summary',{},'Original recipe · saved revision '+selected.value.source.version),el('div',{class:'cooking-original-text'},sourceText),source.notes?el('p',{class:'cooking-original-text'},typeof source.notes==='string'?source.notes:JSON.stringify(source.notes,null,2)):null),
   ingredients,groceryHost,notes.node,el('div',{class:'actions'},button('Retry device save',e=>busy(e.currentTarget,async()=>{
    if(!eligible())return;const original=selected,token=original.value.token,saved=await sessions.retry(original);
    if(selected===original&&selected.value.token===token)selected=saved;paintSave();paintHistory();paintClock();
   }),'quiet'),button('Download cooking progress',()=>exportEntry(selected),'text-button')),el('p',{class:'muted cooking-device-note'},'Progress is local to this browser. Download important notes for another copy.'));
  library.hidden=true;grocery.render(selected);helpReview.render(selected,step?.id??null);paintSave();paintClock();
 }
 const changed=()=>{if(!eligible())return;paintSave();paintHistory();grocery.paint();helpReview.render(selected,selected?position(selected).stepId:null);};m.listeners.add(changed);workspace.hidden=true;
 replace(root,el('link',{rel:'stylesheet',href:new URL('../cooking-workspace.css',import.meta.url).href}),heading('Cooking'),el('nav',{'aria-label':'Reminders workspaces',class:'cooking-workspace-navigation'},el('a',{href:'#reminders'},'Reminders'),el('a',{href:'#reminders?view=cooking','aria-current':'page'},'Recipes & cooking')),downloadStatus,el('div',{class:'cooking-layout'},library,workspace));
 const ready=Promise.all([m.ready,clocks.initialize()]).then(()=>{if(disposed)return;renderLibrary();const id=new URLSearchParams(location.hash.split('?')[1]??'').get('session'),entries=sessions.leaves().filter(entry=>entry.value.cookId===id);if(entries.length===1){selected=entries[0];renderEntry();}else if(id){append(library,el('p',{class:'notice'},entries.length?'Choose which saved version to continue. Each original is preserved.':'This cooking progress is unavailable on this browser. Choose a saved recipe or download retained writing.'));}}).catch(error=>{if(!disposed)replace(library,el('p',{class:'notice'},'Cooking progress could not be opened. Existing originals remain unchanged.'),recoverySection());});
 const custody=new CookingCustody({sessions,clocks,getReady:()=>ready,getView:()=>({eligible:eligible(),selected,rawUnsaved,lease,groceryEpoch:grocery.epoch}),getJournal:()=>m.groceries??null,getHelp:()=>m.help??null});
 const tick=setInterval(()=>{if(!disposed&&!document.hidden)tickClocks();},1000);tick.unref?.();
 return{ready,update(){if(!eligible()){replace(root,heading('Cooking'),empty('Sign in to the workspace where you saved this cooking progress.'));return;}renderLibrary();paintSave();paintClock();grocery.paint();},dirty:()=>custody.dirty(),beforeLeave:()=>safe(),finalBeforeLeave:()=>safe(true),finalCustodyCurrent:()=>custody.current(),destroy(){disposed=true;grocery.retire();helpReview.retire();if(m.view?.lease===lease)m.view=null;custody.destroy();clearInterval(tick);m.listeners.delete(changed);clocks.destroy();}};
}
