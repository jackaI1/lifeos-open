import {demoAssistantChoices} from '../demo-assistant-choices.js';
import {configureDemoComposer} from '../demo-assistant-composer.js';
import {demoAssistantOptions} from '../demo-assistant.js';
import {controlIcon,compactDisclosure} from '../quiet-controls.js';
import {usageIndicator} from '../interactive-usage.js';
import {assistantEffort} from '../assistant-effort.js';
import {DEFAULT_ASSISTANT_PRESET} from '../assistant-presets.js';
import {dismissOnOutside} from '../dialog-position.js';
import { el, replace, append, button, heading, panel, empty, field, status, recordData, busy, showResult, toast, errorNotice, download, modal, safeLink, formatDate } from '../ui.js';

export async function mount(root, ctx) {
  const usage=usageIndicator(ctx);
  const threadList = el('div',{class:'assistant-history'}); const messages = el('div', { class: 'messages assistant-messages', 'aria-live': 'polite', 'aria-relevant': 'additions' }); const jobNode = el('div'); const input = field('', { multiline: true, maxLength: 20000, placeholder: 'Ask for a starting point, record what happened, or correct a record.' }); const composerStatus = status('');
  let ready=false,choosing=0,creating=false;let thread = null; let watcher; let dirty = false; let sending = false; let token = 0; let draftToken = crypto.randomUUID(),savePromise=Promise.resolve(),localDurable=true; const threads = ctx.records('support-thread').filter(t=>!t.data.scope);
  let modelMenu=null,preferenceSave=Promise.resolve(),disposed=false;const preferenceChoices=new Map(),preferenceSaves=new Map();
  const paintModel=(preset,index)=>{if(!modelMenu)return;modelMenu.trigger.dataset.effort=String(index);modelMenu.trigger.setAttribute('aria-label','Model and reasoning effort: '+preset.label);modelMenu.trigger.replaceChildren(controlIcon('effort'),el('span',{class:'assistant-model-name'},preset.label.split(' · ')[0]));};
  const effort=assistantEffort(paintModel);
  modelMenu=compactDisclosure({label:'Model and reasoning effort',icon:'effort',portal:true,content:()=>effort.node});modelMenu.trigger.classList.add('assistant-model-trigger');paintModel(effort.preset,2);
  effort.input.onchange=()=>{const selected=thread,preset=effort.preset;if(!selected)return;
    preferenceChoices.set(selected.id,preset);const operation=preferenceSave.then(async()=>{const current=threads.find(item=>item.id===selected.id)??selected;
      try{const result=await ctx.save('support-thread',current,{model:preset.model,effort:preset.effort});
        if(result.item){const i=threads.findIndex(item=>item.id===selected.id);if(i>=0)threads[i]=result.item;if(thread?.id===selected.id)thread=result.item;if(preferenceSaves.get(selected.id)===operation){preferenceChoices.delete(selected.id);if(!disposed&&thread?.id===selected.id)effort.set(thread.data.model,thread.data.effort);}}
        else if(preferenceSaves.get(selected.id)===operation){if(!result.pending)preferenceChoices.delete(selected.id);if(!disposed&&thread?.id===selected.id){if(!result.pending)effort.set(thread.data.model,thread.data.effort);composerStatus.textContent=result.reason||'Model choice has not synced.';}}
      }catch(error){if(preferenceSaves.get(selected.id)===operation){preferenceChoices.delete(selected.id);if(!disposed&&thread?.id===selected.id){effort.set(thread.data.model,thread.data.effort);composerStatus.textContent=error.message;}}}
    });preferenceSaves.set(selected.id,operation);preferenceSave=operation;return operation;
  };
  async function waitPreferences(){let pending;do{pending=preferenceSave;await pending;}while(pending!==preferenceSave);}
  async function newThread({carryPreset=false}={}) {
    if(disposed||creating)return false;creating=true;examples?.refresh();newChat.disabled=true;const requestId=++token,preset=carryPreset?effort.preset:DEFAULT_ASSISTANT_PRESET,current=()=>!disposed&&token===requestId;
    try{await savePromise;if(!current())return false;if(!localDurable&&dirty){draftWarning();return false;}await waitPreferences();if(!current())return false;
      const result=await ctx.save('support-thread',null,{title:`Conversation ${formatDate(ctx.date())}`,archived:false,model:preset.model,effort:preset.effort});
      if(!result.item){if(current())composerStatus.textContent=result.reason||'Reconnect to create the conversation. Your draft is kept.';return false;}
      if(!threads.some(item=>item.id===result.item.id))threads.unshift(result.item);if(!current()){if(!disposed)renderThreads();return false;}
      if(!await chooseThread(result.item,{keepComposer:carryPreset}))return false;renderThreads();drawer.hidden=true;input.input.focus({preventScroll:true});return true;
    }catch(error){if(current())composerStatus.textContent=error.message;return false;}finally{creating=false;examples?.refresh();newChat.disabled=false;}
  }
  function draftWarning(){replace(composerStatus,'This device could not save the draft. Keep this page open or download it.',button('Download draft',()=>download('lifeos-unsent-message.txt',input.input.value,'text/plain'),'text-button'));}
  function renderThreads() { replace(threadList, ...(threads.length ? threads.filter(record => !record.data.archived).map(record => { const node = button(record.data.title || 'Conversation', async() => {if(await chooseThread(record))drawer.hidden=true;}, `list-button ${record.id === thread?.id ? 'active' : ''}`); return node; }) : [])); }
  async function chooseThread(record,{keepComposer=false}={}) {
    if(disposed)return false;choosing++;examples?.refresh();try{const requestId=++token,id=record.id,oldKey=`draft:support:${thread?.id||'new'}`,key=`draft:support:${id}`,current=()=>!disposed&&requestId===token;
    try{await savePromise;if(!current())return false;if(!localDurable&&dirty){draftWarning();return false;}
      const carried=keepComposer?{token:draftToken,text:input.input.value}:null;
      watcher?.stop();replace(jobNode,null);thread=threads.find(item=>item.id===id)??record;const preset=preferenceChoices.get(id)??thread.data;effort.set(preset.model,preset.effort);renderThreads();replace(messages,empty('Opening conversation...'));composerStatus.textContent='';
      if(!keepComposer){input.input.value='';draftToken=crypto.randomUUID();dirty=false;}
      const restoreToken=draftToken;
      if(carried){localDurable=false;const ok=await ctx.store.put(key,carried);if(!current())return false;localDurable=ok!==false;if(!localDurable){draftWarning();return false;}if(oldKey!==key){await ctx.store.remove(oldKey,carried.token);if(!current())return false;}}
      else{const draft=await ctx.store.get(key);if(!current())return false;if(draft&&draftToken===restoreToken){input.input.value=draft.text;draftToken=draft.token;dirty=true;composerStatus.textContent='Recovered draft on this device';}}
      const response=await ctx.request('/api/records/support-message?limit=1000');if(!current())return false;renderMessages(response.items.filter(item=>item.data.threadId===id));
    }
    catch (error) { if(!disposed&&requestId===token)replace(messages, errorNotice(error)); }
    if(!current())return false;
    const activeJob=(ctx.state.bootstrap.jobs||[]).find(job=>job.threadId===id&&['queued','running'].includes(job.status));
    if(activeJob)watcher=ctx.showJob(jobNode,activeJob,async job=>{await loadMessages(id);if(['completed','succeeded'].includes(job.status)){replace(jobNode);jobNode.classList.remove('job');composerStatus.textContent='Reply saved';}});return true;
    }finally{choosing--;examples?.refresh();}
  }
  function renderMessages(items) { items=items.slice().sort((a,b)=>String(a.createdAt??a.data.createdAt??'').localeCompare(String(b.createdAt??b.data.createdAt??''))||(a.data.role==='user'?-1:1));replace(messages, ...(items.length ? items.map(record => { const data = record.data; return el('article', { class: `message assistant-message ${data.role === 'user' ? 'user' : 'assistant'}` }, el('small', {}, data.role === 'user' ? 'You' : data.mock?'Demo AI':'LifeOS'), data.text || data.content || data.message || '', data.auditId ? button('Undo this change', event => busy(event.currentTarget, async () => showResult(await ctx.action('undo', { auditId: data.auditId }))), 'text-button') : null); }) : [])); messages.scrollTop = messages.scrollHeight; }
  async function loadMessages(id) { if (disposed||thread?.id !== id) return;const requestId=token;try { const [response,list] = await Promise.all([ctx.request('/api/records/support-message?limit=1000'),ctx.request('/api/records/support-thread')]);if(!disposed&&requestId===token&&thread?.id===id){renderMessages(response.items.filter(item => item.data.threadId === id));const fresh=list.items.filter(t=>!t.data.scope).map(item=>{const saved=threads.find(t=>t.id===item.id);return saved?.version>item.version?saved:item;});threads.splice(0,threads.length,...fresh);thread=threads.find(t=>t.id===id)??thread;renderThreads();} } catch {} }
  input.input.oninput=()=>{dirty=true;draftToken=crypto.randomUUID();const savedToken=draftToken;savePromise=ctx.store.put(`draft:support:${thread?.id||'new'}`,{token:savedToken,text:input.input.value}).then(ok=>{if(!disposed&&draftToken===savedToken){localDurable=ok!==false;if(!localDurable)draftWarning();}});composerStatus.textContent='Draft on this device';};
  async function sendMessage(example) {
    if(demoMode&&!demoAssistantOptions('support').some(option=>option.id===example?.id&&option.message===input.input.value.trim()))return;
    if(disposed||!input.input.value.trim()||sending)return;
    sending=true;
    const text=input.input.value.trim(),sentToken=draftToken;let requestToken=token,threadId=thread?.id;const current=()=>!disposed&&token===requestToken&&thread?.id===threadId;
    try{
      if(!thread){if(!await newThread({carryPreset:true}))return;requestToken=token;threadId=thread.id;}
      await savePromise;
      await waitPreferences();
      if(!current())return;
      const preset=effort.preset,result = await ctx.job('support', { threadId, message: text, model:preset.model, effort:preset.effort });
      if (result.pending && result.durable !== true) {
        if(!disposed&&token===requestToken&&thread?.id===threadId)composerStatus.textContent = 'Not yet sent. Browser storage failed. Keep this page open until the request is saved.';
        return;
      }
      if (result.job || result.pending) {
        await ctx.store.remove(`draft:support:${threadId}`, sentToken);if(disposed||thread?.id!==threadId)return;
        if (draftToken === sentToken) { input.input.value = ''; dirty = false; }
        if(token!==requestToken){const selectedToken=token;await loadMessages(threadId);if(!disposed&&token===selectedToken&&thread?.id===threadId&&result.job){watcher?.stop();watcher=ctx.showJob(jobNode,result.job,async job=>{await loadMessages(threadId);if(['completed','succeeded'].includes(job.status)){replace(jobNode);jobNode.classList.remove('job');composerStatus.textContent='Reply saved';}});}return;}
        composerStatus.textContent = result.pending ? 'Request not yet sent' : 'Request accepted on your computer';
        append(messages, el('article', { class: 'message assistant-message user' }, el('small', {}, 'You'), text)); messages.scrollTop = messages.scrollHeight;
        if (result.job) { watcher?.stop(); watcher = ctx.showJob(jobNode, result.job, async job=>{await loadMessages(threadId);if(['completed','succeeded'].includes(job.status)){replace(jobNode);jobNode.classList.remove('job');composerStatus.textContent='Reply saved';}}); }
      }
    }catch(error){if(current())composerStatus.textContent=error.message;}finally{sending=false;}
  }
  const send=button('Send',event=>busy(event.currentTarget,sendMessage));
  const demoMode=configureDemoComposer(ctx.state.session,input.input,send);
  const examples=demoAssistantChoices({session:ctx.state.session,scope:'support',input:input.input,onSend:sendMessage,onDraft:()=>newThread(),canSend:()=>ready&&!creating&&!sending&&!choosing,onBlocked:text=>{composerStatus.textContent=text;}});
  const corrections = panel('Corrections & requests', button('Report a bug or request a feature', () => ctx.reportBug(), 'quiet'), el('div', { class: 'rule' }), button('Review correction history', async event => busy(event.currentTarget, async () => { const response = await ctx.request('/api/audit'); modal('Correction history', el('div', {}, response.items?.length ? response.items.map(item => el('div', { class: 'practice-row row' }, el('div', {}, el('h3', {}, `${item.kind} · ${item.recordId || ''}`), el('p', { class: 'muted' }, `${formatDate(item.createdAt)} · ${item.actor || 'Owner'}`)), !item.undoOf ? button('Undo', event => busy(event.currentTarget, async () => showResult(await ctx.action('undo', { auditId: item.id }))), 'text-button') : status('Undo record'))) : empty('No corrections have been recorded.'))); }), 'text-button'));
  const newChat=button(controlIcon('newChat'),e=>busy(e.currentTarget,()=>newThread()),'text-button icon-button');newChat.setAttribute('aria-label','New chat');
  const sidebar=button(controlIcon('sidebar'),()=>{drawer.hidden=!drawer.hidden;sidebar.setAttribute('aria-expanded',String(!drawer.hidden));},'text-button icon-button');sidebar.setAttribute('aria-label','Conversation history');
  const close=button(controlIcon('close'),()=>{drawer.hidden=true;sidebar.setAttribute('aria-expanded','false');},'text-button icon-button');close.setAttribute('aria-label','Close conversation history');
  const drawer=el('aside',{class:'assistant-drawer',hidden:true,'aria-label':'Conversation history'},el('div',{class:'assistant-drawer-heading'},el('h2',{},'Chats'),close),threadList);
  const stopDismiss=dismissOnOutside(drawer,()=>{drawer.hidden=true;sidebar.setAttribute('aria-expanded','false');},{enabled:()=>!drawer.hidden&&!document.querySelector('#dialog')?.open,isOutside:e=>!drawer.contains(e.target)&&!sidebar.contains(e.target)});
  const options=compactDisclosure({label:'Conversation options',icon:'more',content:()=>corrections});
  send.replaceChildren(controlIcon('send'));send.className='assistant-send icon-button';send.setAttribute('aria-label','Send message');input.input.setAttribute('aria-label','Message');input.input.rows=1;
  input.input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&matchMedia('(hover: hover) and (pointer: fine)').matches){e.preventDefault();send.click();}});
  replace(root,el('section',{class:'assistant-page'},el('header',{class:'assistant-header'},sidebar,el('h1',{},'LifeOS Support'),usage.node,newChat),drawer,messages,examples,jobNode,el('form',{class:'assistant-composer',onsubmit:e=>{e.preventDefault();send.click();}},input.node,el('div',{class:'assistant-composer-tools'},options.node,modelMenu.node,send)),composerStatus));

  renderThreads();if(threads.length)await chooseThread(threads[0]);else{replace(messages,el('p',{class:'muted assistant-empty'},'Ask how to use LifeOS or describe a problem. Your conversation stays in this workspace.'));const openingToken=token,restoreToken=draftToken,draft=await ctx.store.get('draft:support:new');if(!disposed&&token===openingToken&&draftToken===restoreToken&&draft){input.input.value=draft.text;draftToken=draft.token;dirty=true;composerStatus.textContent='Recovered draft on this device';}}
  ready=true;examples?.refresh();
  return { dirty: () => dirty&&!localDurable, destroy: () => { disposed=true;stopDismiss();token += 1; watcher?.stop();usage.destroy();options.destroy();modelMenu.destroy(); } };
}
