import {el,button} from './ui.js';
import {demoAssistantOptions,isDemoAssistant} from './demo-assistant.js';
/** Share normal send/draft handling; an example never replaces unsent writing. */
export function demoAssistantChoices({session,scope,input,onSend,onDraft,hasDraft=()=>!!input.value.trim(),onBlocked=()=>{},canSend=()=>true}){
 if(!isDemoAssistant(session))return null;
 let busy=false;
 const buttons=demoAssistantOptions(scope).map(option=>{
  const choice=button(option.label,async event=>{
   if(busy||event?.detail>1)return;
   if(!canSend()){onBlocked('Wait for this conversation and its saved draft to finish opening.');return;}
   busy=true;refresh();
   try{
    // A read-only demo draft must not block examples or be silently overwritten.
    // Normal New chat preserves it under its original conversation's draft key.
    if(hasDraft()&&(!onDraft||!await onDraft()||hasDraft())){onBlocked('Your earlier draft is kept. Open a new chat to try an example.');return;}
    input.value=option.message;input.dispatchEvent(new Event('input',{bubbles:true}));await onSend(option);if(!input.value.trim()){node.open=false;node.querySelector('summary').textContent='Try another question';}
   }catch(error){onBlocked(error.message||'This question could not be sent. Please try again.');}
   finally{busy=false;refresh();}
  },'quiet demo-assistant-choice');
  choice.dataset.example=option.id;return choice;
 });
 const node=el('details',{class:'demo-assistant-choices',open:true},el('summary',{},'Try a question'),el('div',{class:'demo-assistant-choice-list'},buttons));
 function refresh(){for(const b of buttons)b.disabled=busy||!canSend();}
 node.refresh=refresh;refresh();return node;
}

