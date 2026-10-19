import {el,replace,button,heading,field,select,busy,toast,download,empty,sectionTabs,modal} from './ui.js';
import {controlIcon} from './quiet-controls.js';
import {mountAssistant} from './assistant-chat.js';
import {mountProjectPreparations} from './project-preparations.js';

const categories=[{value:'personal-project',label:'Personal project'},{value:'school-project',label:'School-related project'},{value:'wildcard',label:'Wildcard'}];
const states=[{value:'active',label:'Active'},{value:'later',label:'Later'},{value:'completed',label:'Completed'},{value:'archived',label:'Archived'}];
const editable=data=>Object.fromEntries(['title','category','notes','status','archived','nextStep','steps','timeBlocks'].filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));

// Experimental beta workspace. Original records and the original ticket view remain available.
export async function mountProjectWorkspace(root,ctx,query){
 let preparations=null;
 let disposed=false,dirty=false,durable=true,saving=false,helper=null,openingHelper=false,closingHelper=false,closeRequested=false,draftToken=crypto.randomUUID(),saveChain=Promise.resolve();
 const openedRoute=location.hash,projects=()=>ctx.records('project'),id=query.get('project');
 let current=projects().find(r=>r.id===id);
 if(current?.data.canonicalProjectId)current=projects().find(r=>r.id===current.data.canonicalProjectId);
 const open=r=>ctx.go('tickets?project='+encodeURIComponent(r.id));
 if(id&&id!=='new'&&!current){replace(root,heading('Project unavailable'),empty('This project is no longer in the current workspace.'),button('Back to projects',()=>ctx.go('tickets'),'quiet'));return {};}
 if(!id){
  let filter='active';const list=el('div',{class:'project-list'}),tabs=sectionTabs(states.filter(s=>s.value!=='archived').map(s=>({id:s.value,label:s.label})),filter,next=>{filter=next;paint();});
  list.id=tabs.panelId;list.setAttribute('role','tabpanel');list.setAttribute('aria-labelledby',tabs.labelId);
  function paint(){if(disposed)return;list.setAttribute('aria-labelledby',tabs.node.querySelector('[aria-selected="true"]')?.id||tabs.labelId);const rows=projects().filter(r=>!r.data.archived&&(r.data.status||'active')===filter);replace(list,...(rows.length?rows.map(r=>el('article',{class:'project-list-row'},el('div',{},button(r.data.title,()=>open(r),'text-button project-title'),r.data.nextStep?el('p',{class:'project-next-action'},r.data.nextStep):el('p',{class:'muted'},'Choose a next action'),el('small',{class:'muted'},categories.find(c=>c.value===r.data.category)?.label||'Project')),button('Open',()=>open(r),'quiet'))):[empty(filter==='active'?'No active projects. Add something you want to move forward.':filter==='later'?'No projects saved for later.':'No completed projects yet.')]));}
  const add=button(controlIcon('add'),()=>ctx.go('tickets?project=new'),'quiet icon-button');add.setAttribute('aria-label','Add project');
  replace(root,heading('Tickets & projects',null,el('div',{class:'actions'},add)),el('section',{class:'project-overview'},tabs.node,list),el('div',{class:'project-ledger-link'},button('Weekly tickets and recorded time',()=>ctx.go('tickets?classic=1'),'text-button')));paint();
  return {update:paint,destroy(){disposed=true;}};
 }
 let key='draft:project:'+(current?.id||'new');
 const stored=await ctx.store.get(key),projectId=current?.id||stored?.projectId||crypto.randomUUID();
 let version=current?.version??0;
 const base={title:'',category:'personal-project',notes:'',status:'active',archived:false,nextStep:'',...editable(current?.data||{})};
 const matching=stored?.version===version,data=matching?{...base,...stored.data}:base;
 if(matching&&stored.token)draftToken=stored.token;
 const recoveryKey='recovery:project:'+projectId+':'+(stored?.token||crypto.randomUUID());let originalPreserved=!stored||matching;
 async function preserveOriginal(){if(originalPreserved)return true;const ok=await ctx.store.put(recoveryKey,stored);originalPreserved=ok!==false;return originalPreserved;}
 dirty=matching;const title=field('Project name',{value:data.title,required:true,maxLength:300}),next=field('Next action',{multiline:true,value:data.nextStep,maxLength:2000,placeholder:'One small thing you can do next'}),notes=field('Notes',{multiline:true,value:data.notes,maxLength:10000}),category=select('Ticket category',categories,data.category),state=select('Project state',states,data.status);
 const saveState=el('p',{class:'project-save-state',role:'status'}),assistantHost=el('section',{class:'project-assistant',hidden:true}),preparedHost=el('section',{hidden:true}),head=heading(current?.data.title||'New project'),form=el('div',{class:'project-editor'}),saveButton=button('Save changes',event=>busy(event.currentTarget,save));
 head.classList.add('project-workspace-heading');
 let steps=structuredClone(data.steps??[]),timeBlocks=structuredClone(data.timeBlocks??[]);
 const values=()=>({...editable(base),steps,timeBlocks,title:title.input.value.trim(),nextStep:next.input.value,notes:notes.input.value,category:category.input.value,status:state.input.value});
 const message=text=>{if(!disposed)saveState.textContent=text;};
 function keep(){dirty=true;preparations?.updateContext();draftToken=crypto.randomUUID();const token=draftToken,writeKey=key,snapshot={token,projectId,version,data:values()};durable=false;saveChain=saveChain.catch(()=>false).then(async()=>await preserveOriginal()?ctx.store.put(writeKey,snapshot):false).then(ok=>{if(token===draftToken){durable=ok!==false;message(durable?'Draft saved on this device':'This device could not save your draft. Keep this page open or download it.');}return ok!==false;}).catch(()=>{if(token===draftToken){durable=false;message('This device could not save your draft. Keep this page open or download it.');}return false;});return saveChain;}
 for(const control of [title.input,next.input,notes.input,category.input,state.input])control.addEventListener('input',keep);
 async function save(){
  if(saving||disposed||!title.input.reportValidity())return false;saving=true;
  const sent=values(),token=draftToken,saveKey=key;
  try{
   await saveChain;if(!await preserveOriginal()){message('The earlier draft could not be preserved. Download it before saving changes.');return false;}const result=await ctx.save('project',{id:projectId,version},sent);
   if(result.item){current=result.item;version=result.item.version;Object.assign(base,editable(result.item.data));
    if(saveKey==='draft:project:new'){key='draft:project:'+projectId;if(!disposed&&location.hash===openedRoute){history.replaceState(null,'','#tickets?project='+encodeURIComponent(projectId));ctx.state.routeHash=location.hash;await ctx.timers.enterRoute?.(location.hash);}}
    if(token===draftToken){dirty=false;durable=true;await ctx.store.remove(saveKey,token);message('Saved to LifeOS');preparations?.updateContext();if(!disposed)head.querySelector('h1').textContent=result.item.data.title;}
    else{const previousToken=draftToken;if(await keep()&&saveKey!==key)await ctx.store.remove(saveKey,previousToken);}return true;
   }
   await keep();message(result.reason||'Changes are still on this device. Save again when connected.');return false;
  }catch(error){await keep();message(error.message||'Could not save. Your draft is kept.');return false;}
  finally{saving=false;}
 }
 async function beforeLeave(){await saveChain;if(openingHelper){toast('Project help is still opening. Try leaving once it finishes.');return false;}if(dirty&&!durable){toast('Download your project draft before leaving. This device could not save it.');return false;}if(helper&&!await helper.beforeLeave())return false;if(preparations&&!await preparations.beforeLeave()){toast('Keep this page open or download the pending prepared-work decision.');return false;}return true;}
 const back=button(controlIcon('left'),()=>ctx.go('tickets'),'quiet icon-button');back.setAttribute('aria-label','Back to projects');head.querySelector('div').insertBefore(back,head.querySelector('h1'));
 const focus=button('Start focus',event=>busy(event.currentTarget,async()=>{
  if((dirty||!current)&&!await save())return;if(disposed)return;
  const row=[...(ctx.timers.rows?.values()??[])].find(r=>r.data.state!=='finished'&&r.data.target?.kind==='project'&&r.data.target.id===projectId);
  if(row?.data.state==='running'){await ctx.timers.open();return;}
  const started=row?await ctx.timers.resumeProject(row.id,projectId):await ctx.timers.start({title:title.input.value||'Project',category:categories.find(c=>c.value===category.input.value)?.label||'Project',target:{kind:'project',id:projectId},automatic:false});
  if(disposed)return;if(started?.data.state!=='running'||started.data.target?.kind!=='project'||started.data.target.id!==projectId){message('Focus is paused. Open this project and try again.');return;}message('Focus timer started. It pauses when you leave this page.');focus.textContent='View focus timer';
 }),'quiet');
 function helpMode(open){form.hidden=open;preparedHost.hidden=open||!preparedHost.dataset.available;root.classList.toggle('project-help-open',open);assistantHost.hidden=!open;}
 function revealHelp(){root.scrollIntoView({block:'start',behavior:'instant'});helper?.focus();}
 async function closeHelp(){
  if(!helper){if(openingHelper)closeRequested=true;return;}
  if(closingHelper)return;closingHelper=true;const closing=helper;
  try{if(!await closing.beforeLeave()||disposed||helper!==closing)return;
   closing.destroy();helper=null;helpMode(false);replace(assistantHost);help.textContent='Prepare a starting point';help.focus({preventScroll:true});help.scrollIntoView({block:'nearest',behavior:'instant'});void preparations?.reload();
  }finally{closingHelper=false;}
 }
 const help=button('Prepare a starting point',event=>busy(event.currentTarget,async()=>{
  if(disposed||openingHelper)return;if(helper){revealHelp();return;}if((dirty||!current)&&!await save())return;if(disposed)return;openingHelper=true;closeRequested=false;helpMode(true);root.scrollIntoView({block:'start',behavior:'instant'});
  try{const mounted=await mountAssistant(assistantHost,ctx,'today',{embedded:true,projectId,projectVersion:current.version,initialKey:'project:'+projectId,initialMessage:'Help me start this project. Prepare one useful piece of work I can review and a small next action.',sendInitial:true,onClose:closeHelp,onReviewPreparation:async id=>{await closeHelp();if(!helper&&!disposed)await preparations?.review(id);}});if(disposed){mounted.destroy();return;}helper=mounted;help.textContent='Project help is open';if(closeRequested)await closeHelp();else revealHelp();}
  catch(error){if(!disposed&&!helper){helpMode(false);replace(assistantHost);message(error.message||'Project help could not open. Your project is kept.');}throw error;}
  finally{openingHelper=false;}
 }),'quiet');
 const reviewPrepared=button('Review prepared work',()=>preparations?.review(),'text-button project-prepared-shortcut');reviewPrepared.hidden=true;
 const recovery=stored&&!matching?el('details',{class:'project-draft-recovery'},el('summary',{},'An older draft is available'),el('p',{},'The saved project changed. Your current project is shown; the earlier draft has not replaced it.'),button('Download older draft',()=>download('lifeos-project-earlier-draft.json',JSON.stringify(stored.data,null,2),'application/json'),'text-button')):null;
 replace(form,title.node,next.node,el('div',{class:'project-focus-actions'},focus,help,reviewPrepared),el('details',{class:'project-details'},el('summary',{},'Notes and project details'),notes.node,el('div',{class:'field-grid'},category.node,state.node)),recovery,el('div',{class:'project-save-actions'},saveButton,button('Download draft',()=>download('lifeos-project-draft.json',JSON.stringify(values(),null,2),'application/json'),'text-button')),saveState);
 const plan=el('section',{class:'project-plan'});
 function paintPlan(){replace(plan,el('h2',{},'Steps'),...steps.map(step=>{const checkbox=el('input',{type:'checkbox',checked:step.done,'aria-label':step.title});checkbox.onchange=async()=>{step.done=checkbox.checked;await keep();await save();};return el('label',{class:'check'},checkbox,step.title);}),button('Add step',()=>{const title=field('Step title',{required:true,maxLength:300});modal('Add project step',el('div',{},title.node,button('Save step',e=>busy(e.currentTarget,async()=>{if(!title.input.reportValidity())return;steps.push({id:crypto.randomUUID(),title:title.input.value,done:false});await keep();if(await save()){document.querySelector('#dialog').close();paintPlan();}}))));},'quiet'),el('h2',{},'Time blocks'),...timeBlocks.map(block=>el('p',{},block.day+' · '+block.minutes+' min')),button('Add time block',()=>{const day=field('Day',{type:'date',value:ctx.date()}),minutes=field('Minutes',{type:'number',min:1,max:1440,value:25});modal('Plan a time block',el('div',{},day.node,minutes.node,button('Save time block',e=>busy(e.currentTarget,async()=>{if(!minutes.input.reportValidity())return;timeBlocks.push({id:crypto.randomUUID(),minutes:Number(minutes.input.value),day:day.input.value});await keep();if(await save()){document.querySelector('#dialog').close();paintPlan();}}))));},'quiet'));}paintPlan();
 replace(root,head,form,plan,preparedHost,assistantHost);preparations=mountProjectPreparations(preparedHost,ctx,{projectId,getContext:()=>({version:projects().find(r=>r.id===projectId)?.version??version,dirty}),onAvailability:({count,available})=>{reviewPrepared.hidden=!available;reviewPrepared.textContent=count?'Review prepared work ('+count+')':'Review prepared work';}});message(matching?'Recovered draft from this device':current?'Saved to LifeOS':'Not saved yet');
 return {preparationsReady:preparations.ready,dirty:()=>dirty||saving||openingHelper||!!helper?.dirty()||preparations.dirty(),beforeLeave,update(){helper?.update();preparations.update();},destroy(){disposed=true;helper?.destroy();preparations.destroy();root.classList.remove('project-help-open');}};
}
