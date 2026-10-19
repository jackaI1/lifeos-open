import {preparedWorkContent} from './project-preparations.js';
import {DEFAULT_ASSISTANT_PRESET} from './assistant-presets.js';
import {assistantEffort} from './assistant-effort.js';
import {markdownMessage} from './assistant-markdown.js';
import {renderAssistantMath} from './assistant-math.js';
import {chooseLecturePhoto} from './lecture-photos.js';
import {usageIndicator} from './interactive-usage.js';
import {el,replace,button,heading,field,select,busy,toast,download,formatDate,formatTime,modal} from './ui.js';
import {controlIcon,compactDisclosure} from './quiet-controls.js';
import {routeQuery} from './targets.js';
import {dismissOnOutside} from './dialog-position.js';
const names={today:'Personal assistant',academics:'Academic advisor',finances:'Financial advisor',lecture:'Lecture Tutor'},base=scope=>scope==='today'?'today':scope==='finances'?'finances':'school';
export function assistantButton(ctx,scope){const b=button(controlIcon('chat'),()=>ctx.go(base(scope)+'?assistant'),'quiet icon-button');b.setAttribute('aria-label',names[scope]);b.title=names[scope];return b;}
export function assistantPollDelay(job,sentAt=0,now=Date.now()){if(job.status==='running')return 2000;if(/quota|reserve|allowance|sign-in|earlier/i.test(job.waiting||job.progress||''))return 30000;return /computer/i.test(job.waiting||job.progress||'')?(now-sentAt<60000?3000:15000):2000;}
export async function mountAssistant(root,ctx,scope,options={}){
 let sentForPollingAt=0,loadSequence=0,watchedJob=null,selectionSave=Promise.resolve();
 const usage=ctx.capabilities?.usage===false?{node:null,refresh:async()=>{},destroy(){}}:usageIndicator(ctx);
 const localScope=scope+(options.lectureId?':'+options.lectureId:'')+(options.projectId?':project:'+options.projectId:''),embedded=!!options.embedded;
 let disposed=false,thread=null,threads=[],watchTimer=null,job=null,draftToken=crypto.randomUUID(),dirty=false,localDurable=true,sending=false,generation=0,savePromise=Promise.resolve(),lastMessage='',attachments=[],useVisibleNotes=true,uploadingPhotos=0,creating=false;
 const messages=el('div',{class:'assistant-messages','aria-live':'polite','aria-relevant':'additions'}),state=el('div',{class:'assistant-state',role:'status',hidden:true}),input=field('',{multiline:true,maxLength:12000,placeholder:options.placeholder??(options.projectId?'Ask for a starting point or review an idea…':scope==='lecture'?'Ask about this slide…':scope==='academics'?'Ask about priorities, progress, or planning…':scope==='finances'?'Ask about your budget or spending plan…':'Ask or change something about your day…')}),history=el('div',{class:'assistant-history'});let effortMenu=null;const paintEffortTrigger=(preset,index)=>{if(!effortMenu)return;effortMenu.trigger.dataset.effort=String(index);effortMenu.trigger.setAttribute('aria-label','Model and reasoning effort: '+preset.label);effortMenu.trigger.replaceChildren(controlIcon('effort'),el('span',{class:'assistant-model-name'},preset.label.split(' · ')[0]));};const effort=assistantEffort(paintEffortTrigger);
 input.input.setAttribute('aria-label','Message');
 const report=(text,action)=>{const activityOpen=state.querySelector('details')?.open??false;state.hidden=!text;replace(state,text?(text.length>90?el('details',{class:'assistant-activity',open:activityOpen},el('summary',{},'Activity'),markdownMessage(text)):el('span',{},text)):null,action??null);};
 const acceptsThread=t=>!options.projectId||t?.data?.projectId===options.projectId&&t.data.preparationOnly===true;
 const preparationState=el('p',{class:'project-preparation-state'});
 const launchKey=options.initialKey?'assistant:launch:'+localScope+':'+options.initialKey:null;
 const draftKey=()=>`draft:assistant:${localScope}:${thread?.id??'new'}`;
 const menu=compactDisclosure({label:'Model and reasoning effort',icon:'effort',portal:true,content:()=>effort.node});effortMenu=menu;menu.trigger.classList.add('assistant-model-trigger');paintEffortTrigger(effort.preset,2);
 const newChat=button(controlIcon('newChat'),()=>void newThread().catch(e=>report(e.message)),'text-button icon-button');newChat.setAttribute('aria-label',options.projectId?'New project preparation':'New chat');
 const sidebar=button(controlIcon('sidebar'),()=>{drawer.hidden=!drawer.hidden;sidebar.setAttribute('aria-expanded',String(!drawer.hidden));if(!drawer.hidden)renderHistory();},'text-button icon-button');sidebar.setAttribute('aria-label','Conversation history');sidebar.setAttribute('aria-expanded','false');
 const closeHistory=button(controlIcon('close'),()=>hideHistory(),'text-button icon-button');closeHistory.setAttribute('aria-label','Close conversation history');
 const drawer=el('aside',{class:'assistant-drawer',hidden:true,'aria-label':'Conversation history'},el('div',{class:'assistant-drawer-heading'},el('h2',{},'Chats'),closeHistory),history);
 function hideHistory(){drawer.hidden=true;sidebar.setAttribute('aria-expanded','false');}
 const historyKey=e=>{if(e.key!=='Escape'||e.defaultPrevented||drawer.hidden||document.querySelector('#dialog')?.open)return;const restore=drawer.contains(document.activeElement)||document.activeElement===sidebar;hideHistory();if(restore)sidebar.focus({preventScroll:true});e.preventDefault();e.stopPropagation();};document.addEventListener('keydown',historyKey);
 const stopHistoryDismiss=dismissOnOutside(drawer,hideHistory,{enabled:()=>!drawer.hidden&&!document.querySelector('#dialog')?.open,isOutside:e=>!drawer.contains(e.target)&&!sidebar.contains(e.target)});
 const back=button(controlIcon(embedded?'close':'left'),()=>embedded?options.onClose?.():ctx.go(base(scope)),'quiet icon-button');back.setAttribute('aria-label',embedded?(scope==='lecture'?'Close tutor':'Close assistant'):'Back to '+(scope==='today'?'Today':scope==='finances'?'Finances':'Academics'));
 const attachmentRow=el('div',{class:'tutor-attachments'}),contextRow=el('div',{class:'tutor-context'});
 const attach=button(controlIcon('image'),()=>chooseLecturePhoto(file=>void addPhoto(file)),'quiet icon-button');attach.setAttribute('aria-label','Attach photo');
 const visibleToggle=el('input',{type:'checkbox',checked:true});visibleToggle.onchange=()=>{useVisibleNotes=visibleToggle.checked;saveDraft();};if(scope==='lecture'&&options.contextAvailable!==false)contextRow.append(el('label',{},visibleToggle,'Visible notes and slide'));
 function paintAttachments(){replace(attachmentRow,...attachments.map(a=>el('span',{class:'tutor-attachment'},el('img',{src:a.photo?.image||a.image,alt:'Attached photo'}),button(controlIcon('close'),()=>{attachments=attachments.filter(x=>x.id!==a.id);paintAttachments();saveDraft();},'quiet icon-button'))));for(const b of attachmentRow.querySelectorAll('button'))b.setAttribute('aria-label','Remove attached photo');}
 async function addPhoto(file){if(disposed)return;if(attachments.length+uploadingPhotos>=2){report('Attach up to two photos per question.');return;}const expected=thread?.id,selectedGeneration=generation,current=()=>!disposed&&generation===selectedGeneration&&thread?.id===expected;uploadingPhotos++;send.disabled=true;try{report('Saving photo…');const a=await options.addPhoto(file);if(!current())return;attachments.push(a);paintAttachments();saveDraft();report(a.state==='saved'?'':'Photo saved on this device. It will retry when you send.');}catch(e){if(current())report(e.message);}finally{uploadingPhotos--;send.disabled=sending||uploadingPhotos>0;}}
 async function attachExistingPhoto(id){
  if(disposed)return false;if(attachments.length+uploadingPhotos>=2)throw Error('Attach at most two photos');
  const expected=thread?.id,selectedGeneration=generation,current=()=>!disposed&&generation===selectedGeneration&&thread?.id===expected;
  uploadingPhotos++;send.disabled=true;
  try{const p=await options.readPhoto(id);if(!current())return false;attachments.push({id,state:'saved',photo:p,item:p.item});paintAttachments();saveDraft();input.input.focus({preventScroll:true});return true;}
  finally{uploadingPhotos--;send.disabled=sending||uploadingPhotos>0;}
 }
 const send=button(controlIcon('send'),()=>void sendMessage(),'assistant-send icon-button');send.setAttribute('aria-label','Send message');
 replace(root,el('section',{class:'assistant-page'+(embedded?' assistant-embedded':'')},el('header',{class:'assistant-header'},sidebar,el('h1',{},options.projectId?'Project help':names[scope]),usage.node,newChat),options.projectId?preparationState:null,drawer,messages,state,scope==='lecture'?contextRow:null,el('form',{class:'assistant-composer',onsubmit:e=>{e.preventDefault();void sendMessage();}},scope==='lecture'?attachmentRow:null,input.node,el('div',{class:'assistant-composer-tools'},scope==='lecture'?attach:back,ctx.capabilities?.modelChoice===false?null:menu.node,send))));
 function saveDraft(){dirty=true;draftToken=crypto.randomUUID();const key=draftKey(),value={token:draftToken,text:input.input.value,attachments,useVisibleNotes,threadId:thread?.id??null};savePromise=ctx.store.put(key,value).then(ok=>{localDurable=ok!==false;if(!localDurable)report('This device could not save the draft.',button('Download draft',()=>download('lifeos-unsent-message.txt',input.input.value,'text/plain'),'text-button'));});};
 function sizeComposer(){if(input.input.scrollHeight){input.input.style.height='auto';input.input.style.height=Math.min(input.input.scrollHeight,180)+'px';}}
 input.input.rows=1;input.input.oninput=()=>{saveDraft();sizeComposer();};input.input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&matchMedia('(hover: hover) and (pointer: fine)').matches){e.preventDefault();void sendMessage();}};if(scope==='lecture')input.input.onpaste=e=>{const files=[...(e.clipboardData?.items??[])].filter(i=>i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();for(const file of files.slice(0,2-attachments.length))void addPhoto(file);}};
 const preferenceSaves=new Map(),preferenceBusy=new Set(),preferenceChoices=new Map();
 effort.input.onchange=()=>{
  if(!thread)return;
  const selected=thread,preset=effort.preset,id=selected.id,previous=preferenceSaves.get(id)??Promise.resolve();
  preferenceChoices.set(id,preset);preferenceBusy.add(id);loadSequence++;
  const operation=previous.then(async()=>{
   const current=thread?.id===id?thread:threads.find(t=>t.id===id)??selected;
   try{
    const result=await ctx.outbox.submit('/api/assistant/threads/'+id+'/preferences',{version:current.version,effort:preset.effort,model:preset.model},'PUT');
    if(result.item){const index=threads.findIndex(t=>t.id===id);if(index>=0)threads[index]=result.item;if(thread?.id===id)thread=result.item;if(preferenceSaves.get(id)===operation){preferenceChoices.delete(id);if(!disposed&&thread?.id===id)effort.set(thread.data.model,thread.data.effort);}return{saved:true};}
    if(preferenceSaves.get(id)===operation&&!result.pending)preferenceChoices.delete(id);
    if(!disposed&&thread?.id===id&&preferenceSaves.get(id)===operation){if(!result.pending)effort.set(thread.data.model,thread.data.effort);report(result.reason||'Model choice has not synced. Your question is kept as a draft.');}
    return{saved:false};
   }catch(e){if(preferenceSaves.get(id)===operation){preferenceChoices.delete(id);if(!disposed&&thread?.id===id){effort.set(thread.data.model,thread.data.effort);report(e.message);}}return{saved:false};}
   finally{if(preferenceSaves.get(id)===operation){preferenceBusy.delete(id);loadSequence++;if(!disposed&&thread?.id===id)watch(watchedJob);}}
  });
  preferenceSaves.set(id,operation);return operation;
 };
 async function preferencesSaved(id){let pending,result;do{pending=preferenceSaves.get(id);result=await pending;}while(pending!==preferenceSaves.get(id));return result?.saved!==false;}
 function mathText(text){const node=markdownMessage(text);void renderAssistantMath(node,{inlineDollar:scope==='lecture'});return node;}
 function renderHistory(){replace(history,...threads.map(t=>button(t.data.title||formatDate(t.createdAt),()=>void choose(t).then(chosen=>{if(chosen)hideHistory();}),'list-button'+(thread?.id===t.id?' active':''))));}
 async function newThread(carry=false){
  if(disposed||creating)return false;if(uploadingPhotos){report('Wait for the photo to finish saving.');return false;}
  creating=true;newChat.disabled=true;
  const previousId=thread?.id,selectedGeneration=++generation,preset=carry?effort.preset:DEFAULT_ASSISTANT_PRESET,current=()=>!disposed&&generation===selectedGeneration;
  try{
   await savePromise;if(!current())return false;
   if(!localDurable&&dirty){report('Download the draft before starting another chat.',button('Download draft',()=>download('lifeos-unsent-message.txt',input.input.value,'text/plain'),'text-button'));return false;}
   const key='assistant:creating:'+localScope;let pending=await ctx.store.get(key);if(!current())return false;
   if(!pending){pending={id:crypto.randomUUID(),scope,...(options.lectureId?{lectureId:options.lectureId}:{}),...(options.projectId?{projectId:options.projectId,projectVersion:options.projectVersion}:{}),effort:preset.effort,model:preset.model,mutationId:crypto.randomUUID()};await ctx.store.put(key,pending);if(!current())return false;}
   const result=await ctx.outbox.submit('/api/assistant/threads',pending);
   if(!result.item){if(current())report(result.reason||'Reconnect to create the conversation. Your draft is kept.');return false;}
   if(!threads.some(t=>t.id===result.item.id))threads.unshift(result.item);
   await ctx.store.remove(key);
   if(!current()){if(!disposed)renderHistory();return false;}
   if(carry&&launchKey){await ctx.store.put(launchKey,{id:result.item.id});if(!current())return false;}
   if(!await choose(result.item,{keepComposer:carry}))return false;
   hideHistory();menu.hide();report('');sizeComposer();input.input.focus({preventScroll:true});return true;
  }catch(e){if(current())report(e.message);return false;}finally{creating=false;newChat.disabled=false;if(!disposed&&thread?.id===previousId)watch(watchedJob);}
 }
 async function choose(next,{keepComposer=false}={}){
  if(disposed)return false;if(!acceptsThread(next)){report('This conversation belongs to another workspace.');return false;}if(uploadingPhotos){report('Wait for the photo to finish saving.');return false;}
  const previousId=thread?.id,selectedGeneration=++generation,id=next.id,oldKey=draftKey(),key=`draft:assistant:${localScope}:${id}`,current=()=>!disposed&&generation===selectedGeneration;
  try{
   await savePromise;if(!current())return false;
   if(!localDurable&&dirty){report('Download the draft before changing chats.',button('Download draft',()=>download('lifeos-unsent-message.txt',input.input.value,'text/plain'),'text-button'));return false;}
   clearTimeout(watchTimer);watchedJob=null;thread=threads.find(t=>t.id===id)??next;historyReplace();
   const preset=preferenceChoices.get(id)??thread.data;effort.set(preset.model,preset.effort);
   const carried=keepComposer?{token:draftToken,text:input.input.value,attachments:[...attachments],useVisibleNotes,threadId:id}:null;
   if(!keepComposer){input.input.value='';draftToken=crypto.randomUUID();attachments=[];useVisibleNotes=true;visibleToggle.checked=true;dirty=false;}
   const restoreToken=draftToken;replace(messages);report('');paintAttachments();sizeComposer();renderHistory();
   // Selection writes are ordered, so an older navigation cannot become the next launch's last chat.
   const operation=selectionSave.catch(()=>{}).then(()=>ctx.store.put('assistant:last:'+localScope,{id}));selectionSave=operation;
   await operation;if(!current())return false;
   if(carried){
    localDurable=false;const ok=await ctx.store.put(key,carried);if(!current())return false;localDurable=ok!==false;
    if(!localDurable){report('This device could not save the draft. Keep this page open or download it.',button('Download draft',()=>download('lifeos-unsent-message.txt',input.input.value,'text/plain'),'text-button'));return false;}
    if(ok!==false&&oldKey!==key){await ctx.store.remove(oldKey,carried.token);if(!current())return false;}
   }else{
    const draft=await ctx.store.get(key);if(!current())return false;
    if(draft&&draftToken===restoreToken){input.input.value=draft.text;draftToken=draft.token;attachments=draft.attachments??[];useVisibleNotes=draft.useVisibleNotes!==false;visibleToggle.checked=useVisibleNotes;dirty=!!draft.text||attachments.length>0;}
   }
   paintAttachments();sizeComposer();renderHistory();await load();return current();
  }catch(e){if(current())report(e.message);return false;}finally{if(!disposed&&thread?.id===previousId)watch(watchedJob);}
 }
 function historyReplace(){if(embedded||disposed)return;window.history.replaceState(null,'','#'+base(scope)+'?assistant='+encodeURIComponent(thread.id));ctx.state.routeHash=location.hash;}
 const formatValue=(key,value)=>{if(value===null)return 'Clear';if(typeof value==='boolean')return value?'Yes':'No';if(['start','end','dueAt'].includes(key)&&value)return formatDate(value)+' · '+formatTime(value);return String(value);};
 const fieldNames={remainingMinutes:'Minutes remaining',nextStep:'Next step',userNotes:'Your note',dueDate:'Due date',dueAt:'Due time',wakeTime:'Wake',lightsOut:'Bedtime',schoolMorningStart:'School morning starts',schoolMorningEnd:'School morning ends',schoolAfternoonStart:'School afternoon starts',schoolAfternoonEnd:'School afternoon ends',quietStart:'Quiet hours start',quietEnd:'Quiet hours end',hidden:'Hide from schedule',day:'LifeOS day',status:'State',title:'Title',notes:'Notes',category:'Category',start:'Start',end:'End',location:'Location'};
 function proposalView(record){const p=record.data.proposal,applied=['applied','undone'].includes(record.data.status),heading=({'task-create':'Create academic task',task:'Update academic task',project:'Update project',preferences:'Change routine', 'schedule-adjust':'Adjust this schedule entry','calendar-create':'Add to Personal calendar'})[p.operation];
  const node=el('section',{class:'assistant-proposal'},el('h3',{},record.data.targetTitle||heading),el('dl',{},p.fields.map(f=>[el('dt',{},fieldNames[f.name]||f.name),el('dd',{},formatValue(f.name,f.value))])));
  if(record.data.status==='blocked')node.append(el('p',{role:'status'},record.data.error||'This change needs current information.'));
  if(applied){node.append(el('span',{class:'muted'},record.data.status==='undone'?'Undone':record.data.calendarCommandId?(record.data.calendarState==='provider-confirmed'?'Personal calendar updated':record.data.calendarState==='failed'?'Calendar needs retry':'Calendar change queued'):'Applied'));if(record.data.status!=='undone'&&(record.data.auditId||record.data.calendarCommandId))node.append(button('Undo',e=>e.detail>1?undefined:busy(e.currentTarget,async()=>{const r=await ctx.request('/api/assistant/proposals/'+record.id+'/undo',{method:'POST',body:{version:record.version,mutationId:crypto.randomUUID()}});if(r.pending){report(r.reason);return;}await ctx.refresh();await load();}),'text-button'));}
  else if(record.data.status==='proposed'&&record.data.expiresAt>Date.now())node.append(button('Apply change',e=>e.detail>1?undefined:busy(e.currentTarget,async()=>{const r=await ctx.request('/api/assistant/proposals/'+record.id+'/apply',{method:'POST',body:{version:record.version,mutationId:crypto.randomUUID()}});if(r.pending){report(r.reason);return;}await ctx.refresh();await load();toast(r.queued?'Saved. Personal calendar update queued.':'Change applied.');}),'quiet compact'));
  return node;
 }
 function glossaryControl(message){const b=button(controlIcon('study'),()=>{const term=field('Term',{maxLength:200}),definition=field('Meaning',{multiline:true,value:message.data.text.slice(0,12000),maxLength:12000});modal('Save to glossary',el('div',{class:'form-stack'},term.node,definition.node,button('Save as corrected misunderstanding',()=>{const evidence=message.data.evidence;if(!evidence?.courseId){toast('Open this course’s Learning map to save an earlier explanation.');return;}const wrong=field('What I misunderstood',{multiline:true,maxLength:6000}),why=field('What changed my understanding',{multiline:true,maxLength:6000});modal('Save misconception',el('div',{class:'form-stack'},term.node,wrong.node,definition.node,why.node,button('Save',e=>busy(e.currentTarget,async()=>{const result=await ctx.outbox.submit('/api/learning-notes',{id:crypto.randomUUID(),version:0,data:{type:'misconception',courseId:evidence.courseId,title:term.input.value,text:definition.input.value.slice(0,6000),misunderstanding:wrong.input.value,reasoning:why.input.value,status:'learning',lectureId:evidence.lectureId,linkedIds:[]}});toast(result.item?'Saved to the misconception notebook':result.reason);if(result.item)document.querySelector('#dialog').close();}), 'quiet')));},'text-button'),button('Save',async()=>{try{if(!term.input.value.trim())throw Error('Enter a term');const slide=options.getSlide?.(),note=options.getNote?.();const result=await ctx.outbox.submit('/api/lectures/'+options.lectureId+'/study',{id:options.lectureId+'-s-'+crypto.randomUUID().replaceAll('-',''),version:0,data:{type:'glossary',term:term.input.value.trim(),definition:definition.input.value,explanationId:message.id,...(note?.pageId?{pageId:note.pageId}:{}),...(slide?{sourceId:slide.sourceId,sourcePage:slide.pageNumber}:{})}},'PUT');toast(result.item?'Saved to glossary':result.reason);if(result.item||result.durable)document.querySelector('#dialog').close();}catch(e){toast(e.message);}})) );},'quiet icon-button');b.setAttribute('aria-label','Save explanation to glossary');return b;}
 function visualReceipt(message){const data=message.data;if(!data.note&&!data.slide?.image&&!data.photoIds?.length)return null;const details=el('details',{class:'tutor-visual-receipt'},el('summary',{},'Included notes and photos'));let loaded=false;details.addEventListener('toggle',async()=>{if(!details.open||loaded)return;loaded=true;for(const [image,label]of [[data.note?.image,'Visible notes when sent'],[data.slide?.image,'Slide when sent']])if(image)details.append(el('img',{src:image,alt:label,loading:'lazy'}));for(const id of data.photoIds??[]){try{const p=await options.readPhoto?.(id);if(p)details.append(el('img',{src:p.image,alt:p.title||'Attached photo',loading:'lazy'}));}catch{details.append(el('p',{},'Photo needs a connection to reopen.'));}}});return details;}
 function preparationView(message){if(!options.projectId||!message.data.preparation)return null;return el('details',{class:'project-artifact-chat'},el('summary',{},'Prepared '+message.data.preparation.artifact.kind+': '+message.data.preparation.artifact.title),preparedWorkContent(message),button('Review in project',()=>options.onReviewPreparation?.(message.id),'text-button'));}
 function evidenceView(message){const e=message.data.evidence;if(!e)return null;return el('details',{class:'tutor-evidence'},el('summary',{},'Source and assumptions'),...(e.sources??[]).map(s=>el('blockquote',{},s.quote)),!(e.sources??[]).length?el('p',{},'No exact source text was cited. Treat the explanation as the tutor’s reasoning.'):null,...(e.assumptions??[]).map(s=>el('p',{},s)),e.sourceId?button('Open slide '+e.sourcePage,()=>{if(options.openSource)options.openSource(e.sourceId,e.sourcePage);else ctx.go('school?lectures='+e.courseId+'&lecture='+e.lectureId+'&source='+e.sourceId+'&slide='+e.sourcePage);},'text-button'):null);}
 async function load(){if(!thread||disposed)return;const expected=thread.id,token=generation,sequence=++loadSequence;try{const data=await ctx.request('/api/assistant/threads/'+expected);if(disposed||token!==generation||thread.id!==expected||sequence!==loadSequence)return;if(!preferenceBusy.has(expected))thread=data.thread;const at=threads.findIndex(t=>t.id===thread.id);if(at>=0)threads[at]=thread;
   if(options.projectId)preparationState.textContent=data.thread.data.projectVersion===options.projectVersion?'Uses this project and its notes. Suggestions leave your project unchanged.':'Prepared from an earlier project version. Your newer writing is unchanged.';
   const nearBottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<90,previous=messages.querySelectorAll('article').length;replace(messages,...data.messages.map(m=>el('article',{class:'assistant-message '+m.data.role,'aria-label':m.data.role==='user'?'You':names[scope]},m.data.mock?el('small',{class:'muted'},'Demo AI'):null,mathText(m.data.text),scope==='lecture'&&m.data.role==='user'?visualReceipt(m):null,scope==='lecture'&&m.data.role==='assistant'?glossaryControl(m):null,evidenceView(m),preparationView(m),...(m.data.proposalIds??[]).map(id=>data.proposals.find(p=>p.id===id)).filter(Boolean).map(proposalView))));
   
   if(data.stream?.reply&&!data.messages.some(m=>m.data.jobId===data.job?.id&&m.data.role==='assistant'))messages.append(el('article',{class:'assistant-message assistant streaming','aria-label':data.job?.status==='running'?'Reply in progress':'Reply awaiting save'},mathText(data.stream.reply)));
   lastMessage=data.messages.filter(m=>m.data.role==='user').at(-1)?.data.text??'';if(nearBottom||!previous)messages.scrollTop=messages.scrollHeight;
   if(job&&['queued','running'].includes(job.status)&&!['queued','running'].includes(data.job?.status)){void usage.refresh(true);if(data.proposals.some(p=>p.data.status==='applied'))void Promise.resolve(ctx.refresh()).catch(()=>{});}job=data.job;if(job){report(data.stream?.reply&&job.status==='running'?'':job.waiting,retryControl(job));watch(job);}else{const calendar=data.proposals.find(p=>p.data.status==='applied'&&p.data.calendarCommandId&&p.data.calendarState==='queued'),failed=data.proposals.find(p=>p.data.calendarState==='failed');if(calendar){report('Updating Personal calendar…');watch({id:'calendar-'+calendar.data.calendarCommandId,status:'queued'});}else{watch(null);report(failed?failed.data.calendarError||'The calendar update needs attention.':'');}}renderHistory();
  }catch(e){if(token===generation)report(e.message);}}
 function retryControl(current){return ['failed','needs-input'].includes(current.status)?button('Use this message again',()=>{input.input.value=lastMessage;input.input.oninput();input.input.focus();},'text-button'):null;}
 function watch(initial){watchedJob=initial;clearTimeout(watchTimer);if(disposed||document.hidden||!initial?.id||!['queued','running'].includes(initial.status))return;const expected=thread.id;
  const delay=assistantPollDelay(initial,sentForPollingAt);
  watchTimer=setTimeout(async()=>{if(disposed||document.hidden||thread?.id!==expected)return;try{await load();}catch(e){report(e.message);watch({...initial,waiting:'Waiting for computer'});}},delay);
 }
 async function sendMessage(){if(disposed)return;if(uploadingPhotos){report('The photo is still saving.');return;}if(sending||!input.input.value.trim())return;const message=input.input.value.trim(),token=draftToken,sentAt=new Date().toISOString(),sentAttachments=[...attachments],includeVisibleNotes=useVisibleNotes;let expected=thread?.id,selectedGeneration=generation;const current=()=>!disposed&&thread?.id===expected&&generation===selectedGeneration;sentForPollingAt=Date.now();sending=true;send.disabled=true;try{if(!thread){if(!await newThread(true))return;expected=thread.id;selectedGeneration=generation;}const key=draftKey();await savePromise;if(!await preferencesSaved(expected)){if(current())report('Model choice has not synced. Your question is kept as a draft.');return;}if(!current())return;
   for(let i=0;i<sentAttachments.length;i++)if(sentAttachments[i].state!=='saved'){sentAttachments[i]=await options.retryPhoto(sentAttachments[i]);if(!current())return;if(sentAttachments[i].state!=='saved')throw Error('Photo is still on this device. Reconnect and send again.');if(draftToken===token)attachments=[...sentAttachments];}const visual=scope==='lecture'&&includeVisibleNotes?await options.getVisual?.()??{}:{};
   if(disposed||thread?.id!==expected||generation!==selectedGeneration)return;
   const preset=effort.preset;const result=await ctx.outbox.submit('/api/assistant/threads/'+expected+'/messages',{message,sentAt,model:preset.model,effort:preset.effort,...(scope==='lecture'?{...visual,photoIds:sentAttachments.map(a=>a.id)}:{})});if(result.pending&&!result.durable){if(current())report(result.reason);return;}
   await ctx.store.remove(key,token);if(disposed||thread?.id!==expected)return;
   if(draftToken===token){input.input.value='';sizeComposer();attachments=[];paintAttachments();dirty=false;}if(generation!==selectedGeneration){await load();return;}lastMessage=message;
   if(result.pending){messages.append(el('article',{class:'assistant-message user'},message));report(result.reason);return;}
   thread=result.thread;await load();
  }catch(e){if(current())report(e.message);}finally{sending=false;send.disabled=uploadingPhotos>0;}}
 const visibility=()=>{clearTimeout(watchTimer);if(!document.hidden)void load();};document.addEventListener('visibilitychange',visibility);
 const openingGeneration=generation,openingDraftToken=draftToken,openingCurrent=()=>!disposed&&generation===openingGeneration;
 async function openInitial(){
  const listing=await ctx.request('/api/assistant/threads?scope='+scope+(options.lectureId?'&lectureId='+encodeURIComponent(options.lectureId):'')+(options.projectId?'&projectId='+encodeURIComponent(options.projectId):''));
  if(!openingCurrent()){if(!disposed){for(const item of listing.items.filter(acceptsThread))if(!threads.some(t=>t.id===item.id))threads.push(item);renderHistory();}return false;}
  threads=listing.items.filter(acceptsThread);
  const requested=embedded?null:routeQuery().get('assistant');
  let launch=launchKey?await ctx.store.get(launchKey):null;
  if(!openingCurrent())return false;
  // Recover chats created before assignment-to-conversation links were saved.
  // A title is only a candidate; the full original message must match.
  if(launchKey&&!launch&&options.initialMessage){
   const candidate=threads.find(t=>t.data.title===options.initialMessage.slice(0,70));
   if(candidate){
    const existing=await ctx.request('/api/assistant/threads/'+encodeURIComponent(candidate.id));if(!openingCurrent())return false;
    if(existing.messages.some(m=>m.data.role==='user'&&m.data.text===options.initialMessage)){
     launch={id:candidate.id};await ctx.store.put(launchKey,launch);if(!openingCurrent())return false;
    }
   }
  }
  const last=await ctx.store.get('assistant:last:'+localScope);if(!openingCurrent())return false;
  let selected=threads.find(t=>t.id===(launch?.id||requested||last?.id))??(!launch?threads[0]:null);
  if(launch&&!selected&&!options.projectId){selected=(await ctx.request('/api/assistant/threads/'+encodeURIComponent(launch.id))).thread;if(!openingCurrent())return false;}
  if(selected&&!acceptsThread(selected))selected=null;
  if(selected&&(launch||requested!=='new'))return choose(selected,{keepComposer:dirty&&draftToken!==openingDraftToken});
  else{
   renderHistory();const restoreToken=draftToken,draft=await ctx.store.get(draftKey());if(!openingCurrent())return false;
   if(draft&&draftToken===restoreToken){input.input.value=draft.text;draftToken=draft.token;attachments=draft.attachments??[];useVisibleNotes=draft.useVisibleNotes!==false;visibleToggle.checked=useVisibleNotes;paintAttachments();dirty=!!draft.text||attachments.length>0;}
   replace(messages,el('p',{class:'muted assistant-empty'},scope==='academics'?'Ask about your schedule, a deadline or what to bring to class.':scope==='lecture'?'Ask about a concept in your course notes or the selected slide.':'Ask for help with your next step.'));
  }
  return true;
 }
 let opened=false;try{opened=await openInitial();}catch(e){if(openingCurrent())report(e.message);}
 if(opened&&!disposed&&options.initialMessage&&!input.input.value&&!thread){input.input.value=options.initialMessage;saveDraft();sizeComposer();if(options.sendInitial)void sendMessage();}
 if(opened&&options.initialPhotoIds?.length)for(const id of options.initialPhotoIds.slice(0,2)){if(!await attachExistingPhoto(id))break;}
 return {focus:()=>input.input.focus({preventScroll:true}),attachPhoto:attachExistingPhoto,dirty:()=>(dirty&&!localDurable)||sending||uploadingPhotos>0,beforeLeave:async()=>{if(uploadingPhotos){toast('Wait for the photo to finish saving before closing.');return false;}await savePromise;if(!localDurable&&dirty){toast('Download the unsent message before leaving. This device could not save it.');return false;}return true;},update:()=>{if(!sending)void load();},destroy(){disposed=true;generation++;clearTimeout(watchTimer);stopHistoryDismiss();document.removeEventListener('keydown',historyKey);menu.destroy();usage.destroy();document.removeEventListener('visibilitychange',visibility);}};
}
