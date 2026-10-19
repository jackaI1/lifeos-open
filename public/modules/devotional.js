import {trashEntryButton} from '../deleted.js';
import {devotionalJournal} from '../devotional-journal.js';
import {compactDisclosure,syncControl,elapsedSave,controlIcon} from '../quiet-controls.js';
import {followResponseFocus} from '../response-focus.js';
import {nextDevotionalPassage} from '../devotional-types.js';
import {historyEntry,passageGroups,completedDays} from '../devotional-history.js';
import {openAccountability,accountabilityOpeningOwner} from '../accountability-ui.js';
import {shiftDay} from '../day-navigation.js';
import {routeQuery} from '../targets.js';
import {autoGrowResponse} from '../auto-grow-response.js';
import {passagePicker} from '../passage-picker.js';
import { el, replace, append, button, heading, panel, field, select, empty, status, formatDate, modal, download, errorNotice, safeLink, toast, busy, showResult } from '../ui.js';
import { DevotionalController, PROMPTS } from '../devotional-controller.js';

export async function mount(root, ctx) {
  const saveState = status('Opening', 'pending'); const metadata = el('p', { class: 'save-meta no-margin' }); const errors = el('div'); const editor = el('div'); const history = el('div', { class: 'history-list' }); const imports = el('div', { class: 'history-list' });
  const picker = field('Entry date', { type: 'date', value: ctx.date(), required: true });
  let inputs = []; let passage;let typeControl,customEditor; let completion; let practicePlan; let practiceContext; let schoolMinutes; let observed; let currentDate; let historyToken = 0;
  let currentId,dayEntries=[],dayToken=0;const dayHistory=el('div'),entrySelect=select('Entry',[]);
  let disposed=false,growers=[],editorOptions=null,practiceTimer=null;const optionsHost=el('span');const accountabilityShown=new Set();
  const todayButton=button(controlIcon('retry'),()=>loadDay(ctx.date()),'quiet icon-button');todayButton.setAttribute('aria-label','Back to today');todayButton.title='Back to today';todayButton.hidden=true;
  const sync=syncControl(()=>controller.save());let savedError=null;const journal=devotionalJournal(ctx,{onOpen:e=>loadDay(e.date,e.id),onDay:day=>loadDay(day),getDay:()=>currentDate});
  function paintSaveIndicator(record){
    if(!record)return;
    const entry=record.entry,local=record.dirty||!ctx.state.online;
    const failed=record.conflict||savedError||record.dirty&&record.storageError;
    const detail=record.dirty&&record.storageError?'This browser could not save a recovery copy. Keep this page open and retry or download your writing.':record.conflict?'Two versions need review. Your writing is preserved.':savedError?'Cloud save failed. Your writing remains on this device.':local?(record.dirty&&record.localSavedToken!==record.token?'Saving on this device…':'Saved on this device. Retry when connected.'):null;
    sync.update({mode:failed?'alert':local?'device':'cloud',label:!entry.version&&!local&&!failed?'Cloud connected':null,updatedAt:entry.updatedAt,detail:!entry.version&&!local&&!failed?'Ready to save':detail,retry:!!failed||!!local});
  }
  const controller = new DevotionalController({ request: ctx.request, store: ctx.store, changed(event) {
    if (event.type === 'loading') { saveState.textContent = 'Opening entry'; return; }
    if (event.type === 'load-error') { replace(errors, errorNotice(event.error)); saveState.textContent = 'Could not open date'; picker.input.value = currentDate || ctx.date(); return; }
    if (!event.active) return;
    const record = event.record;
    if (event.type === 'loaded') { savedError=null;currentId=record.entry.id??record.entry.date;currentDate = record.entry.date; picker.input.value = currentDate; todayButton.hidden=currentDate===ctx.date();renderEditor(record);journal.selectDay(currentDate); }
    if (event.type === 'storage-error') replace(errors, el('p', { class: 'notice', role: 'alert' }, ctx.store.warning));
    if(event.type==='save-error')savedError=event.error;
    if (event.type === 'saved') { savedError=null;record.storageError=false;replace(errors, ); journal.saved(record.entry); }
    if (record.conflict) renderConflict(record);
    const text = record.conflict ? 'Review conflicting versions' : event.type === 'saving' ? 'Saving to LifeOS' : event.type === 'save-error' ? 'Not saved to server' : record.dirty ? 'Draft on this device' : record.entry.updatedAt ? 'Draft saved to LifeOS' : 'Ready to write';
    paintSaveIndicator(record);saveState.textContent = text; saveState.className = `status ${record.conflict ? 'conflict' : record.dirty ? 'pending' : 'saved'}`;
    metadata.textContent = record.entry.updatedAt ? 'Last saved '+new Date(record.entry.updatedAt).toLocaleString() : 'Your writing saves as you go.';
  }});
  function values() { return { type:typeControl.input.value,customText:customEditor.value,points: inputs.map(input => input.value), ...(typeControl.input.value==='custom'?{bookId:null,chapter:null,chapterEnd:null,passage:'Custom devotional'}:{...passage.value,chapterEnd:passage.value.chapterEnd??null}), complete: completion.checked,...(practicePlan.input.value?{plan:practicePlan.input.value}:{}),context:practiceContext.input.value,schoolMinutes:Number(schoolMinutes.input.value||0),...(completion.checked&&observed.input.value?{observedAt:new Date(observed.input.value).toISOString()}:{}) }; }
  function edit() { const data = values(); if (data.type==='custom'?!data.customText.trim():data.points.some(point => !point.trim())) { completion.checked = false; data.complete = false; } controller.edit(data);if(data.complete)void ctx.timers?.finishTarget({kind:'devotional',id:currentId}).catch(()=>{}); }
  function renderEditor(record) {
    practiceTimer?.destroy();practiceTimer?.node.remove();practiceTimer=null;const entry = record.entry;passage?.destroy();growers.forEach(g=>g.destroy());growers=[]; replace(errors, );
    typeControl=select('Devotional type',[{value:'standard',label:'Seven Arrows'},{value:'custom',label:'Custom'}],entry.type??'standard');customEditor=el('textarea',{value:entry.customText??'',maxlength:100000,'aria-label':'Custom devotional',oninput:edit});typeControl.input.onchange=()=>{edit();renderEditor(controller.entries.get(currentId));};
    passage = passagePicker(entry,edit);
    inputs = entry.points.map((text, index) => el('textarea', { value: text, maxlength: 100000, 'aria-label': PROMPTS[index], placeholder: 'Write your reflection...', oninput: edit }));
    practicePlan=select('Plan used',[{value:'',label:'Not recorded'},{value:'A',label:'A · Morning at home'},{value:'B',label:'B · At campus'},{value:'C',label:'C · Before heading home'},{value:'D',label:'D · Recovery'}],entry.plan||'');practiceContext=select('Where this time came from',[{value:'other',label:'Not recorded or other'},{value:'morning',label:'Morning routine'},{value:'planned-school-time',label:'Planned school time'},{value:'before-home',label:'Before heading home'},{value:'recovery',label:'Recovery time'}],entry.context||'other');schoolMinutes=field('Actual planned school minutes used',{type:'number',min:0,max:360,value:entry.schoolMinutes??0});const localInput=value=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};observed=field('Actual completion time',{type:'datetime-local',value:entry.completedAt?localInput(entry.completedAt):''});for(const control of [practicePlan,practiceContext,schoolMinutes,observed])control.input.onchange=edit;
    completion = el('input', { type: 'checkbox', role:'switch', checked: entry.complete, onchange: () => { if (completion.checked && (entry.type==='custom'?!customEditor.value.trim():inputs.some(input => !input.value.trim()))) { completion.checked = false; toast(entry.type==='custom'?'Write your devotional before confirming completion.':'Write a response to all seven prompts before confirming completion.'); return; }if(completion.checked&&!observed.input.value&&entry.date===ctx.date())observed.input.value=localInput(new Date().toISOString()); edit(); } });
    const timerId=currentId,timerEpoch=dayToken;practiceTimer=ctx.timers?.practiceControl?.({kind:'devotional',id:timerId},{current:()=>!disposed&&currentId===timerId&&dayToken===timerEpoch});
    if(practiceTimer)root.querySelector('.page-display')?.append(practiceTimer.node);
    editorOptions?.destroy();editorOptions=compactDisclosure({label:'Devotional options',icon:'more',content:()=>el('div',{class:'form-stack'},typeControl.node)});const esv=button(controlIcon('bible'),()=>window.open('https://www.esv.org/'+encodeURIComponent(passage.value.passage.trim())+'/', '_blank','noopener,noreferrer'),'quiet icon-button');esv.setAttribute('aria-label','Open passage in ESV');esv.title='Open in ESV';esv.hidden=entry.type==='custom';replace(optionsHost,esv,editorOptions.node,trashEntryButton(ctx,()=>({kind:'devotional',id:currentId,version:controller.entries.get(currentId)?.entry.version,label:entry.passage}),async()=>{controller.entries.delete(currentId);await loadDay(currentDate);},()=>{if(controller.entries.get(currentId)?.dirty){toast('Save or download your current edits before deleting.');return false;}return true;}));
    replace(editor,entry.type==='custom'?el('label',{},'Your devotional',customEditor):el('div', { class: 'passage-controls' }, passage.node), el('div', { class: 'entry-points',hidden:entry.type==='custom' }, inputs.map((input, index) => el('label', { class: 'entry-point' }, el('span', { class: 'prompt-title' }, el('span', { class: 'prompt-number' }, String(index + 1).padStart(2, '0')), PROMPTS[index]), input))),
      el('div', { class: 'editor-footer' }, el('label', { class: 'check' }, completion, el('span', {}, 'I have completed my devotional')), el('div', { class: 'actions' }, button('Save now', event => busy(event.currentTarget,explicitSave)), entry.type!=='custom'?button('Accountability message',()=>prepareAccountability(),'quiet'):null, button('Download a copy', () => download(`devotional-${entry.date}.txt`, reflectionText({ ...entry, ...values() })), 'quiet'))));
    growers=[...inputs,customEditor].flatMap(input=>[autoGrowResponse(input),followResponseFocus(input)]);
  }
  async function explicitSave(){
    controller.edit(values());
    const savedId=currentId;const finishTimer=()=>void ctx.timers?.finishTarget({kind:'devotional',id:savedId}).catch(()=>{});
    const owner=accountabilityOwner();
    if(typeControl.input.value==='custom'?!customEditor.value.trim():!passage.valid()||inputs.some(input=>!input.value.trim())){const saved=await controller.save();if(saved)finishTimer();toast(typeControl.input.value==='custom'?'Draft saved.':'Draft saved.');return;}
    const saved=await controller.save(currentId);if(saved)finishTimer();if(saved&&owner.canOpen()){if(saved.type!=='custom'&&saved.complete&&!accountabilityShown.has(saved.id)&&!controller.entries.get(saved.id)?.dirty){accountabilityShown.add(saved.id);await openAccountability(ctx,saved,{isCurrent:owner.isCurrent});}}
  }
  function accountabilityOwner(){const id=currentId,token=dayToken,view=editor.firstChild,raw=JSON.stringify(values());const isCurrent=()=>!disposed&&root.isConnected&&currentId===id&&dayToken===token&&editor.firstChild===view&&JSON.stringify(values())===raw;return{isCurrent,canOpen:accountabilityOpeningOwner(isCurrent)};}
  async function prepareAccountability(){const owner=accountabilityOwner(),id=currentId;await controller.save(id);if(!owner.canOpen())return;const record=controller.entries.get(id);if(record?.dirty||record?.conflict||!record?.entry.complete){toast('Finish and save this devotional first.');return;}await openAccountability(ctx,record.entry,{isCurrent:owner.isCurrent});}
  function reflectionText(entry) {if(entry.type==='custom')return entry.date+'\n\n'+(entry.customText??''); return [entry.date || 'Date unknown', entry.passage || '', ...PROMPTS.map((prompt, index) => `${index + 1}. ${prompt}\n${entry.points?.[index] || ''}`)].join('\n\n'); }
  function renderConflict(record) {
    replace(errors, el('div', { class: 'notice', role: 'alert' }, el('p', {}, 'Another saved version exists. Your writing is safe here. Compare both before choosing which version to continue.'), button('Compare versions', () => {
      const local = record.conflict.draft || record.entry; const remote = record.conflict.current;
      modal('Review both versions', el('div', {}, el('div', { class: 'grid two' }, panel('This device', el('div', { class: 'detail-body' }, reflectionText(local))), panel('Server version', el('div', { class: 'detail-body' }, remote?.points ? reflectionText(remote) : 'Fetch the current server version before resolving.'))), el('div', { class: 'actions' }, button('Continue my draft', async () => { await controller.resolve(true); document.querySelector('#dialog').close(); toast('Your draft was selected and is saving.'); }), button('Use server version', async () => { await controller.resolve(false); document.querySelector('#dialog').close(); toast('Server version selected. Your prior draft remains in local recovery.'); }, 'quiet'), button('Download my draft', () => download(`devotional-recovery-${local.date}.txt`, reflectionText(local)), 'quiet'))));
    }, 'quiet compact')));
  }
  function chooseEntryOptions(selected){
    replace(entrySelect.input,...dayEntries.map((e,index)=>el('option',{value:e.id??e.date,selected:(e.id??e.date)===selected},(e.passage||'New devotional')+(dayEntries.filter(other=>other.passage===e.passage).length>1?' · Entry '+(dayEntries.filter(other=>other.passage===e.passage).findIndex(other=>other.id===e.id)+1):''))));
    entrySelect.node.hidden=dayEntries.length<2;
  }
  async function loadDay(day,id){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day??''))return;
    const token=++dayToken;picker.input.value=day;let result;try{result=await ctx.request('/api/devotionals');}catch{result={entries:[]};}
    if(token!==dayToken||disposed)return;
    dayEntries=(result.entries??[]).filter(e=>e.date===day);const drafts=await ctx.store.list?.('draft:devotional:')??[];
    for(const row of drafts){const e=row.value?.entry;if(e?.date===day&&!dayEntries.some(r=>(r.id??r.date)===(e.id??e.date)))dayEntries.push(e);}
    dayEntries.sort((a,b)=>a.imported&&b.imported?a.bookOrder-b.bookOrder||a.chapter-b.chapter||a.id.localeCompare(b.id):a.imported?1:b.imported?-1:String(a.completedAt??a.createdAt??'').localeCompare(String(b.completedAt??b.createdAt??'')));
    const selected=id??dayEntries[0]?.id??dayEntries[0]?.date??('devo-'+crypto.randomUUID());
    if(!dayEntries.some(e=>(e.id??e.date)===selected))dayEntries.push({id:selected,date:day,passage:'New devotional'});
    chooseEntryOptions(selected);replace(dayHistory);await controller.load(day,selected,{suggestedPassage:nextDevotionalPassage(result.entries??[],day)});
    if(token!==dayToken||disposed)return;globalThis.history.replaceState(null,'','#devotional?day='+day+'&entry='+encodeURIComponent(selected));
  }

  let returnPoint=null,lastWriter=null;
  editor.addEventListener('focusin',event=>{if(event.target.tagName==='TEXTAREA')lastWriter=event.target;});
  const journalHeading=el('h2',{tabindex:'-1'},'Your journal');
  const journalJump=button('Your journal',()=>{const input=lastWriter;if(input&&editor.contains(input))returnPoint={input,id:currentId,text:input.value,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection};else returnPoint=null;journalHeading.scrollIntoView({block:'start',behavior:'instant'});journalHeading.focus({preventScroll:true});},'text-button');
  const entryReturn=button('Back to entry',()=>{const point=returnPoint;if(point&&point.id===currentId&&editor.contains(point.input)&&point.input.isConnected&&point.input.value===point.text){point.input.setSelectionRange?.(point.start,point.end,point.direction);point.input.focus();}else{picker.input.scrollIntoView({block:'center',behavior:'instant'});picker.input.focus({preventScroll:true});}},'text-button');
  entrySelect.input.onchange=()=>loadDay(picker.input.value,entrySelect.input.value);
  const addEntry=button('+',()=>loadDay(picker.input.value,'devo-'+crypto.randomUUID()),'quiet icon-button');addEntry.setAttribute('aria-label','New devotional for selected day');
  picker.input.onchange = () => { if (picker.input.value) void loadDay(picker.input.value); };
  replace(root, heading('Devotional', null, el('div',{class:'actions'},sync.node,optionsHost),formatDate(picker.input.value||ctx.date())), el('div', { class: 'grid wide devotional-layout' }, el('section', { class: 'panel' }, el('div', { class: 'devotional-date-nav' }, picker.node,addEntry,todayButton,journalJump),entrySelect.node,dayHistory, el('div', { class: 'rule' }), errors, editor), el('aside', { class: 'panel sticky-aside' }, el('div', { class: 'panel-heading' }, journalHeading,entryReturn, button('Refresh', ()=>journal.refresh(true), 'text-button')), journal.node)));
  await Promise.allSettled([loadDay(routeQuery().get('day')||ctx.date(),routeQuery().get('entry')), journal.refresh()]);
  return { dirty: () => controller.dirty(), destroy: () => { disposed=true;passage?.destroy();practiceTimer?.destroy();editorOptions?.destroy();journal.destroy();sync.destroy();growers.forEach(g=>g.destroy());historyToken += 1; controller.destroy(); } };
}
