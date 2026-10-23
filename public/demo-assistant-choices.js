import {el,button} from './ui.js';
import {demoAssistantOptions,isDemoAssistant} from './demo-assistant.js';
/** Share normal send/draft handling; an example never replaces unsent writing. */
export function demoAssistantChoices({session,scope,input,onSend,onBlocked=()=>{},canSend=()=>true}){
 if(!isDemoAssistant(session))return null;
 let busy=false;
 const buttons=demoAssistantOptions(scope).map(option=>{
  const choice=button(option.label,async()=>{
   if(busy)return;
   if(!canSend()){onBlocked('Wait for this conversation and its saved draft to finish opening.');return;}
   if(input.value.trim()){onBlocked('Send or clear your current draft before choosing an example.');return;}
   busy=true;refresh();
   try{input.value=option.message;input.dispatchEvent(new Event('input',{bubbles:true}));await onSend();if(!input.value.trim()){node.open=false;node.querySelector('summary').textContent='Try another question';}}
   finally{busy=false;refresh();}
  },'quiet demo-assistant-choice');
  choice.dataset.example=option.id;return choice;
 });
 const node=el('details',{class:'demo-assistant-choices',open:true},el('summary',{},'Try a question'),el('div',{class:'demo-assistant-choice-list'},buttons));
 function refresh(){for(const b of buttons)b.disabled=busy||!canSend();}
 node.refresh=refresh;refresh();return node;
}

