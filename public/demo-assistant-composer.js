import {isDemoAssistant} from './demo-assistant.js';
export const DEMO_ASSISTANT_PLACEHOLDER='No AI is connected for this demo, try a question instead.';
/** Keep saved drafts intact and let only the authored examples submit demo questions. */
export function configureDemoComposer(session,input,send){
 if(!isDemoAssistant(session))return false;
 input.readOnly=true;input.placeholder=DEMO_ASSISTANT_PLACEHOLDER;input.setAttribute('aria-disabled','true');input.classList.add('demo-ai-input');
 if(send)send.disabled=true;
 return true;
}
