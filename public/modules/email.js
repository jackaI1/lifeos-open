import {EmailDrafts} from '../local-email-drafts.js';
import {retainedWritingText} from '../email-draft-schema.js';
import {SAMPLE_MESSAGES,EMAIL_FIXTURE_VERSION} from '../email-preview-data.js';
import {el,replace,button,heading,field,download,toast,formatDate,formatTime} from '../ui.js';
export function mount(root,ctx){
 if(ctx.state.session?.environment!=='beta'){replace(root,heading('Email drafts require a local workspace'));return{destroy(){}};}
 let disposed=false,ready=false,creating=false,showSamples=false,selected=null,editorEntry=null,editorFields=null,editorStatus=null,query='',listScroll=0;
 const draftHost=el('div',{class:'email-draft-list'}),composerHost=el('section',{class:'email-composer',hidden:true}),sampleHost=el('section',{class:'email-samples',hidden:true}),sampleList=el('div',{class:'email-message-list'}),reader=el('article',{class:'email-reader',hidden:true}),sampleStatus=el('p',{class:'muted',role:'status'}),draftStatus=el('p',{class:'muted',role:'status'}),recoveryHost=el('div');
 const drafts=new EmailDrafts({store:ctx.store,environment:'beta',owner:ctx.state.session.email,onChange:()=>{if(!disposed){renderDrafts();paintEditor();}}});
 const exportDraft=entry=>download('lifeos-local-email-draft.json',JSON.stringify(entry.value,null,2),'application/json');
 const statusFor=entry=>entry.error||(!entry.durable?'Saving on this device…':'Saved on this device');
 function paintEditor(){if(!editorEntry||!editorStatus||disposed)return;editorStatus.textContent=statusFor(editorEntry);}
 function draftButton(entry,label){const control=button(label,()=>openDraft(entry),'email-draft-open');control.dataset.draftKey=drafts.key(entry.value);return control;}
 function renderDrafts(){if(disposed)return;const leaves=drafts.leaves();
  draftStatus.textContent=!ready?'Opening local drafts…':leaves.length?leaves.length+' local '+(leaves.length===1?'draft':'drafts')+' · Not sent':'No local drafts yet.';
  const row=entry=>el('article',{class:'email-draft-row'},draftButton(entry,entry.value.data.subject||'Untitled draft'),el('p',{class:'muted'},entry.value.data.to||'No recipient yet'),el('p',{class:'muted'},'Edited '+formatDate(entry.value.updatedAt)+' · '+formatTime(entry.value.updatedAt)),entry.value.data.body?el('p',{class:'email-draft-preview'},entry.value.data.body.slice(0,120)+(entry.value.data.body.length>120?'…':'')):null,el('p',{class:'email-draft-save'},statusFor(entry)),button('Download draft',()=>exportDraft(entry),'text-button'));
  const parents=[...drafts.entries.values()].filter(entry=>!leaves.includes(entry));replace(draftHost,...leaves.map(row),parents.length?el('details',{class:'email-saved-versions'},el('summary',{},'Earlier versions ('+parents.length+')'),...parents.map(row)):null);
  replace(recoveryHost,...(drafts.recoveries.length?[el('details',{class:'email-recovery'},el('summary',{},'Other stored writing ('+drafts.recoveries.length+')'),el('p',{class:'muted'},'These originals could not be opened as current drafts. They have been kept unchanged.'),...drafts.recoveries.map((item,index)=>button('Download retained writing '+(index+1),async()=>download('lifeos-email-retained-writing-'+(index+1)+'.txt',await retainedWritingText(item)),'text-button')))]:[]));
 }
 function focusDraft(entry){const target=Array.from(draftHost.querySelectorAll('button')).find(node=>node.dataset.draftKey===drafts.key(entry.value));(target??newDraft).focus({preventScroll:true});}
 function closeComposer(){const entry=editorEntry;editorEntry=null;editorFields=null;editorStatus=null;composerHost.hidden=true;replace(composerHost);if(entry)focusDraft(entry);}
 function openDraft(entry){
  if(disposed)return;editorEntry=entry;composerHost.hidden=false;
  const to=field('To',{value:entry.value.data.to}),cc=field('Cc',{value:entry.value.data.cc}),bcc=field('Bcc',{value:entry.value.data.bcc}),subject=field('Subject',{value:entry.value.data.subject}),body=field('Body',{multiline:true,value:entry.value.data.body});editorFields={to,cc,bcc,subject,body};editorStatus=el('p',{role:'status',class:'email-save-status'});
  const addressOptions=el('details',{class:'email-address-options'},el('summary',{},'Cc and Bcc'),cc.node,bcc.node);addressOptions.open=!!(entry.value.data.cc||entry.value.data.bcc);
  const capture=()=>Object.fromEntries(Object.entries(editorFields).map(([key,value])=>[key,value.input.value]));
  for(const control of Object.values(editorFields))control.input.addEventListener('input',()=>{if(disposed||editorEntry!==entry)return;entry=drafts.beginEdit(entry);editorEntry=entry;void drafts.edit(entry,capture()).catch(()=>{if(editorStatus)editorStatus.textContent='This writing could not be saved. Download it before leaving.';});});
  const retry=button('Retry saving',async()=>{const before=editorEntry;if(!before)return;const saved=await drafts.retry(before);if(!disposed&&editorEntry===before)openDraft(saved);},'quiet');
  const source=entry.value.source?.source==='fixture'?SAMPLE_MESSAGES.find(message=>message.id===entry.value.source.messageId&&entry.value.source.fixtureVersion===EMAIL_FIXTURE_VERSION):null;
  const quote=source?button('Include sample message',()=>{body.input.value+=(body.input.value?'\n\n':'')+'Quoted fictional message:\n'+source.body;entry=drafts.beginEdit(entry);editorEntry=entry;void drafts.edit(entry,capture());},'text-button'):null;
  replace(composerHost,el('div',{class:'email-composer-heading'},el('h2',{},'Local draft'),button('Back to drafts',closeComposer,'text-button')),el('p',{class:'muted'},'Not sent · Saved only on this browser, when confirmed below.'),to.node,addressOptions,subject.node,body.node,quote,editorStatus,el('div',{class:'actions'},retry,button('Download draft',()=>exportDraft(editorEntry),'text-button')),el('p',{class:'muted email-device-limit'},'Browser data can be cleared. Download important writing for another copy.'));paintEditor();composerHost.scrollIntoView({block:'start',behavior:'instant'});to.input.focus({preventScroll:true});
 }
 async function createDraft(fields={},source){
  if(creating||!ready||disposed)return;creating=true;newDraft.disabled=true;
  try{const entry=await drafts.create(fields,source);if(!disposed)openDraft(entry);}finally{creating=false;if(!disposed)newDraft.disabled=false;}
 }
 const newDraft=button('New local draft',()=>createDraft());newDraft.disabled=true;
 const sampleToggle=button('Try sample inbox',()=>{showSamples=!showSamples;sampleHost.hidden=!showSamples;sampleToggle.textContent=showSamples?'Hide sample inbox':'Try sample inbox';if(showSamples){renderSamples();sampleHost.scrollIntoView({block:'start',behavior:'instant'});sampleHeading.focus({preventScroll:true});}},'quiet');
 const search=field('Search sample messages',{type:'search',placeholder:'Search fictional messages'});search.input.addEventListener('input',()=>{query=search.input.value;renderSamples();});
 function renderSamples(){if(disposed)return;const needle=query.toLowerCase(),messages=SAMPLE_MESSAGES.filter(message=>[message.sender,message.subject,message.body].some(value=>value.toLowerCase().includes(needle)));
  sampleStatus.textContent=messages.length?messages.length+' fictional sample '+(messages.length===1?'message':'messages'):'No sample messages match.';
  replace(sampleList,...messages.map(message=>{const row=button(el('span',{},el('strong',{},message.sender),el('span',{class:'email-message-subject'},message.subject),el('small',{class:'muted'},formatDate(message.date)+' · '+formatTime(message.date)),el('span',{class:'email-message-preview'},message.body.split('\n')[0])),()=>openMessage(message),'email-message-row');row.dataset.messageId=message.id;row.setAttribute('aria-pressed',message.id===selected?'true':'false');return row;}));
 }
 function backToList(){const id=selected;selected=null;reader.hidden=true;sampleHost.classList.remove('email-reader-open');sampleList.scrollTop=listScroll;const row=Array.from(sampleList.querySelectorAll('button')).find(node=>node.dataset.messageId===id);(row??search.input).focus({preventScroll:true});}
 function openMessage(message){selected=message.id;listScroll=sampleList.scrollTop;sampleHost.classList.add('email-reader-open');reader.hidden=false;const title=el('h2',{tabindex:'-1'},message.subject);
  replace(reader,button('Back to sample messages',backToList,'text-button'),el('p',{class:'email-fictional-label'},'Fictional sample · Source read state unchanged'),title,el('p',{class:'muted'},message.sender+' · '+message.address),el('p',{class:'muted'},formatDate(message.date)+' · '+formatTime(message.date)),el('div',{class:'email-message-body'},message.body),...message.attachments.map(item=>el('p',{class:'muted'},item.name+' · '+item.size+' · Attachment unavailable in this preview')),button('Draft reply',()=>createDraft({to:message.address,subject:'Re: '+message.subject},{source:'fixture',fixtureVersion:EMAIL_FIXTURE_VERSION,messageId:message.id,threadId:message.threadId}),'quiet'));renderSamples();title.scrollIntoView({block:'nearest',behavior:'instant'});title.focus({preventScroll:true});
 }
 const sampleHeading=el('h2',{tabindex:'-1'},'Sample inbox · Fictional');
 replace(sampleHost,sampleHeading,search.node,sampleStatus,el('div',{class:'email-inbox-layout'},sampleList,reader));
 replace(root,heading('Email'),el('div',{class:'email-connection'},el('strong',{},'Email is not connected'),el('p',{class:'muted'},'Write local drafts or try fictional messages. No real inbox is being read.'),el('div',{class:'actions'},newDraft,sampleToggle),el('details',{},el('summary',{},'What connecting an inbox would require'),el('p',{class:'muted'},'A separate LifeOS account permission is needed before real mail can be read. This preview does not connect an account or send anything.'))),el('section',{class:'email-drafts'},el('h2',{},'Drafts'),draftStatus,draftHost,recoveryHost),composerHost,sampleHost);
 const opening=drafts.initialize().then(()=>{if(disposed)return;ready=true;newDraft.disabled=false;renderDrafts();}).catch(()=>{if(!disposed){draftStatus.textContent='Local drafts could not be opened. Existing writing has not been removed.';}});renderDrafts();
 return{dirty:()=>drafts.dirty(),finalCustodyCurrent:()=>!drafts.dirty(),finalBeforeLeave(){return this.beforeLeave();},async beforeLeave(){await opening;const safe=await drafts.beforeLeave();if(!safe)toast('Keep this page open or download the unsaved Email writing before leaving.');return safe;},destroy(){disposed=true;drafts.destroy();}};
}
