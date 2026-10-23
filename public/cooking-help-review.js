import {el,append,replace,button,field,download} from './ui.js';
import {cookingRecipeProjection} from './cooking-recipe-selection.js';
import {captureCookingHelpIntent,createCookingHelpRequest} from './cooking-help-contract.js';
import {prepareCookingRecoveryDownload} from './cooking-recovery-download.js';
import {configureDemoComposer} from './demo-assistant-composer.js';
const labels={prepared:'Not sent',waiting:'Waiting for the original request',unknown:'Original outcome not verified',review:'Original needs review','receipt-unretained':'Answer received; device save needed',refused:'Request refused',queued:'Queued',running:'Preparing a draft','needs-input':'More information needed',completed:'Draft answer', 'late-result':'Late draft answer',uncertain:'Original outcome not verified',expired:'Original request expired',failed:'Original request failed',cancelled:'Cancellation recorded',unavailable:'Local help unavailable'};
const displayOriginal=text=>cookingRecipeProjection(text).text;
// This view presents retained originals. It never acquires authority from a
// status paint, disclosure toggle, remount or replacement view.
export function createCookingHelpReview({host,manager,getView,onAdopt,session}){
 let retired=false,entry=null,stepId=null,context=null,boundEntry=null,composer=null,raw='',range=null,draft=null,problem='',active=0,inputEpoch=0;
 const help=()=>manager.help,current=()=>!retired&&getView().eligible&&getView().entry===entry&&getView().stepId===stepId;
 const related=()=>[...(help()?.intents.values()??[])].filter(e=>e.value.intent.cookId===entry?.value.cookId&&e.value.intent.selectedStep.id===stepId);
 const sameSource=intent=>intent.source.kind===entry?.value.source.kind&&intent.source.id===entry?.value.source.id&&intent.source.version===entry?.value.source.version&&intent.source.recipe===entry?.value.source.data.recipe&&intent.selectedStep.id===stepId&&intent.selectedStep.text===entry?.value.steps.find(s=>s.id===stepId)?.text;
 const sameQuestion=intent=>sameSource(intent)&&raw===intent.question&&range?.start===intent.source.range.start&&range?.end===intent.source.range.end;
 const rows=new Map(),historyBody=el('div',{}),history=el('details',{class:'cooking-help-history'},el('summary',{},'Earlier questions'),historyBody);
 function controlState(control,{hidden=false,disabled=false}){
  // A settling receipt may temporarily disappear while its original is being
  // saved. Keep the exact busy action mounted; do not blur then re-enable it.
  const busy=control.getAttribute('aria-busy')==='true',hide=hidden&&!busy,disable=disabled&&!busy;
  if((hide||disable)&&document.activeElement===control&&host.contains(control)){
   (composer.details.open===false?composer.summary:composer.question.input).focus({preventScroll:false});
  }
  if(control.hidden!==hide)control.hidden=hide;
  if(control.disabled!==disable)control.disabled=disable;
 }
 function owned(task){return async event=>{if(!current()||active||event.currentTarget.disabled||!host.contains(event.currentTarget))return;const lease=getView().lease,original=entry,step=stepId,control=event.currentTarget;active++;control.setAttribute('aria-busy','true');paint();
  try{await task();}catch(error){if(current()&&entry===original&&stepId===step&&getView().lease===lease){problem=error.message;paint();}}
  finally{active--;control.removeAttribute('aria-busy');if(current())paint();}
 };}
 function exportOriginal(value){if(!current())return;const result=prepareCookingRecoveryDownload({value},{family:'H'});if(!result.ok){problem=result.reason+' The original remains here.';paint();return;}try{download(result.filename,result.blob);}catch{problem='The browser could not start the download. Keep this page open; the original remains here.';paint();}}
 function validate(){if(!current()||!range||!raw.trim())return null;try{const value=entry.value,step=value.steps.find(s=>s.id===stepId);createCookingHelpRequest(captureCookingHelpIntent({schema:1,operation:'explain-step',environment:'beta',owner:help().owner,requestId:value.token,cookId:value.cookId,branchId:value.branchId,selectionToken:value.token,revision:value.revision,source:{kind:value.source.kind,id:value.source.id,version:value.source.version,recipe:value.source.data.recipe,range},selectedStep:{id:stepId,text:step.text},question:raw}));return null;}catch(error){return error.message;}}
 function retain(){if(!current())return;try{draft=help().setDraft(entry,{stepId,question:raw,range});}catch(error){problem=error.message;}paint();}
 function build(){
  const original=entry.value.source.data.recipe,projection=cookingRecipeProjection(original);inputEpoch++;draft=help().draft(entry,stepId);raw=draft?.value.question??'';range=draft?.value.range??null;problem='';
  const source=field('Original recipe excerpt',{multiline:true,value:projection.text,readonly:true}),question=field('Question',{multiline:true,value:raw,placeholder:'What would help with this step?'}),selection=el('p',{class:'cooking-help-excerpt cooking-original-text',hidden:!range}),notice=el('p',{class:'notice',role:'status',hidden:true}),save=el('p',{class:'muted cooking-help-save',role:'status'}),answerHost=el('div',{class:'cooking-help-answers'}),id='cooking-help-'+crypto.randomUUID();
  source.input.classList.add('cooking-help-source');question.input.classList.add('cooking-help-question');notice.id=id;question.input.setAttribute('aria-describedby',id);question.input.addEventListener('input',()=>{if(!current())return;inputEpoch++;raw=question.input.value;problem='';retain();});
  // Native focus and selection are newer owner intent even without an edit,
  // including a selection that returns to its original offsets. Invalidate
  // only this composer's pending restore; do not persist, send or cancel work.
  for(const input of [source.input,question.input])for(const type of ['focus','select'])input.addEventListener(type,()=>{if(current()&&host.contains(input))inputEpoch++;});
  const use=button('Use selected excerpt',owned(()=>{range=projection.range({recipe:entry.value.source.data.recipe,text:source.input.value,start:source.input.selectionStart,end:source.input.selectionEnd});inputEpoch++;problem='';retain();}),'quiet');
  async function sendQuestion(){problem=validate()??'';if(problem)return;const original=related().find(e=>sameQuestion(e.value.intent));if(original)return help().operation(original.value.requestId);if(!range||!raw.trim()){problem='Select a recipe excerpt and write your question.';return;}retain();if(!draft)throw Error('Keep this question open until it is saved.');await help().ask(entry,{stepId,draftToken:draft.value.token});}
  const ask=button('Ask',owned(sendQuestion)),demo=configureDemoComposer(session,question.input,ask);
  const choices=demo?[
   ['Explain this step','Explain this preparation step using the selected saved recipe excerpt.'],
   ['What should I check?','What should I check in the selected saved recipe excerpt before doing this preparation step?'],
   ['Check the recipe instructions','Help me review the selected saved recipe instructions for this preparation step without inventing missing details.']
  ].map(([label,message])=>button(label,owned(async()=>{
   const previous=help().draft(entry,stepId);if(previous&&!previous.durable)throw Error('Keep the earlier question open until its device save is verified.');
   // Each journal draft has its own immutable key; earlier writing stays retained.
   const selectedRange=range??projection.range({recipe:original,text:source.input.value,start:0,end:source.input.value.length});
   const value=entry.value,step=value.steps.find(s=>s.id===stepId);
   createCookingHelpRequest(captureCookingHelpIntent({schema:1,operation:'explain-step',environment:'beta',owner:help().owner,requestId:value.token,cookId:value.cookId,branchId:value.branchId,selectionToken:value.token,revision:value.revision,source:{kind:value.source.kind,id:value.source.id,version:value.source.version,recipe:original,range:selectedRange},selectedStep:{id:stepId,text:step.text},question:message}));
   inputEpoch++;raw=message;range=selectedRange;question.input.value=raw;problem='';await sendQuestion();
  }),'quiet demo-assistant-choice')):[];
  const retryDraft=button('Retry question save',owned(()=>help().retryLocal()),'quiet');
  const exportDraft=button('Download question draft',()=>{const saved=help()?.draft(entry,stepId);if(current()&&saved)exportOriginal(saved.value);},'text-button');
  const close=button('Close help',()=>{if(!current())return;const focused=document.activeElement===close;composer.details.open=false;if(focused&&document.activeElement===close)composer.summary.focus({preventScroll:true});},'text-button');
  const summary=el('summary',{},'Help with this step'),details=el('details',{class:'cooking-step-help'},summary,el('p',{class:'muted'},demo?'Authored example response. Review it against the saved recipe.':'Local Qwen draft. Review it against the saved recipe.'),el('p',{class:'cooking-original-text'},'Your preparation step: '+entry.value.steps.find(s=>s.id===stepId).text),source.node,el('div',{class:'actions'},use),selection,question.node,choices.length?el('details',{class:'demo-assistant-choices',open:true},el('summary',{},'Try a question'),el('div',{class:'actions'},choices)):null,notice,save,el('div',{class:'actions'},ask,close,retryDraft,exportDraft),answerHost,history);
  composer={details,summary,source,question,selection,notice,save,ask,retryDraft,answerHost,demo,choices};rows.clear();replace(historyBody);replace(host,details);paint();
 }
 function makeRow(saved){
  const intent=saved.value.intent,id=intent.requestId,status=el('p',{class:'muted',role:'status'}),answer=el('div',{}),originals=el('details',{},el('summary',{},'Original question and excerpt'),el('p',{class:'cooking-original-text'},displayOriginal(intent.question)),el('p',{class:'muted'},'Saved recipe'),el('blockquote',{class:'cooking-original-text'},displayOriginal(intent.source.recipe.slice(intent.source.range.start,intent.source.range.end))),button('Download original question',()=>exportOriginal(saved.value),'text-button'));
  const restore=button('Use original question',owned(async()=>{
   if(!sameSource(intent))throw Error('Return to this question’s original recipe and preparation step.');
   const previous=help().draft(entry,stepId),persistence=previous?.persistence,epoch=inputEpoch,previousRaw=raw,previousRange=range,previousEntry=entry,token=entry.value.token,lease=getView().lease;let timer;
   try{const saved=await Promise.race([(async()=>{if(previous){await persistence;return help().physical(help().key(previous.value),previous.value);}return !raw;})(),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),2000);})]);
    if(!saved)throw Error('Keep your newer question open until its device save is verified.');
    if(!current()||entry!==previousEntry||entry.value.token!==token||getView().lease!==lease||inputEpoch!==epoch||help().draft(entry,stepId)!==previous||previous?.persistence!==persistence||raw!==previousRaw||range!==previousRange||!sameSource(intent))throw Error('Your newer selection or writing was kept. Choose the original question again when ready.');
    inputEpoch++;raw=intent.question;range=structuredClone(intent.source.range);composer.question.input.value=raw;problem='';if(document.activeElement===restore)composer.question.input.focus({preventScroll:false});retain();
   }finally{clearTimeout(timer);}
  }),'quiet');
  const check=button('Check original request',owned(()=>help().observe(id)),'quiet'),retry=button('Retry original request',owned(()=>help().retryExact(id)),'quiet'),cancel=button('Request cancellation',owned(()=>help().cancel(id)),'text-button'),local=button('Retry device save',owned(()=>help().retryLocal()),'quiet'),adopt=button('Add as a new step',owned(async()=>{const result=await help().adopt(id,entry);if(!current())return;onAdopt(result);problem='The suggested step is added for your review. Your current step is unchanged.';}),'quiet');
  const node=el('section',{class:'cooking-help-outcome'},status,originals,answer,el('div',{class:'actions'},check,retry,cancel,local,restore,adopt));return{node,status,answer,check,retry,cancel,local,restore,adopt,result:null};
 }
 function paint(){
  if(!current()||!composer||!help())return;const invalid=validate(),message=problem||invalid||'';composer.notice.hidden=!message;composer.notice.textContent=message;composer.question.input.setAttribute('aria-invalid',String(!!invalid));
  composer.selection.hidden=!range;composer.selection.textContent=range?'Chosen excerpt: '+displayOriginal(entry.value.source.data.recipe.slice(range.start,range.end)):'';
  const saved=help().draft(entry,stepId);composer.save.textContent=saved?(saved.error||(!saved.durable?'Saving question on this device…':'Question saved on this device')):'';
  controlState(composer.retryDraft,{hidden:!saved||saved.durable});
  const matching=related().find(e=>sameQuestion(e.value.intent));controlState(composer.ask,{disabled:composer.demo||!active&&(!range||!raw.trim()||!!matching)}); // owned() is the synchronous repeat fence.
  for(const choice of composer.choices)controlState(choice,{disabled:!!active});
  const originals=related();for(const original of originals){const id=original.value.requestId;let row=rows.get(id);if(!row){row=makeRow(original);rows.set(id,row);}const op=help().operation(id),result=op?.receipt?.result;
   // Explain this exact retained refusal without turning it into an unfinished
   // job or gaining retry/cancellation authority from a presentation label.
   const disabledHelp=op.status==='refused'&&[...help().facts.values()].some(f=>f.value.requestId===id&&f.value.kind==='error'&&f.value.method==='POST'&&f.value.outcome?.status===503&&f.value.outcome?.code==='cooking_help_unavailable');
   row.status.textContent=(disabledHelp?labels.unavailable:composer.demo&&op.status==='completed'?'Example response':labels[op.status]??'Original needs review')+(op.cancelRequested?' · Cancellation requested; an answer may still arrive':'');
   if(result&&JSON.stringify(result)!==row.result){row.result=JSON.stringify(result);replace(row.answer,el('p',{class:'cooking-original-text'},result.explanation),result.sourceExcerpts.length?el('details',{},el('summary',{},'Sources in this draft'),result.sourceExcerpts.map(excerpt=>el('div',{},el('p',{class:'muted'},excerpt.field==='recipe'?'Saved recipe':'Your preparation step'),el('blockquote',{class:'cooking-original-text'},displayOriginal(excerpt.text))))):null,result.questions.map(text=>el('p',{class:'cooking-original-text'},text)),result.suggestedStepText?el('div',{},el('p',{class:'muted'},'Suggested preparation step · not reviewed'),el('p',{class:'cooking-original-text'},result.suggestedStepText)):null);}
   const questionMatches=sameQuestion(original.value.intent);controlState(row.restore,{hidden:op.status!=='completed'||!sameSource(original.value.intent)||questionMatches||!!help().adoptions.get(id),disabled:!!active});
   const unfinished=['prepared','waiting','queued','running','unknown','uncertain','needs-input','expired','failed','unavailable'].includes(op.status),pending=op.requestPending||!!active;
   controlState(row.check,{hidden:!unfinished,disabled:pending});controlState(row.retry,{hidden:op.status!=='unknown',disabled:pending});controlState(row.cancel,{hidden:!unfinished||op.cancelRequested,disabled:pending});controlState(row.local,{hidden:op.durable,disabled:pending});
   controlState(row.adopt,{hidden:!(op.status==='completed'&&result?.suggestedStepText&&!op.receipt.sourceChanged&&!op.cancelRequested&&!op.receipt.cancelled&&!op.receipt.late),disabled:!questionMatches||!!help().adoptions.get(id)});
   // Move only non-composer outcome regions. Never replace the Question or its
   // caret when an original finishes after newer writing.
   const target=original===originals.at(-1)?composer.answerHost:historyBody;if(row.node.parentNode!==target)append(target,row.node);
  }
  history.hidden=originals.length<2;
 }
 function render(value,selectedStep){
  if(retired)return;entry=value;stepId=selectedStep;const step=entry?.value.steps.find(s=>s.id===stepId),recipe=entry?.value.source.data.recipe;
  if(!step||typeof recipe!=='string'||!help()){context=null;composer=null;replace(host);return;}
  const next=JSON.stringify([entry.value.cookId,entry.value.branchId,entry.value.source.kind,entry.value.source.id,entry.value.source.version,stepId,step.text,recipe]);if(context===next&&boundEntry===entry&&composer){paint();return;}context=next;boundEntry=entry;build();
 }
 return{render,paint,retire(){retired=true;},get rawQuestion(){return raw;}};
}
