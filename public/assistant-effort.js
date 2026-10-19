import {el} from './ui.js';
import {ASSISTANT_PRESETS,DEFAULT_ASSISTANT_PRESET} from './assistant-presets.js';
export function assistantEffort(onChange=()=>{}){
 const input=el('input',{type:'range',min:0,max:ASSISTANT_PRESETS.length-1,step:1,value:0,'aria-label':'Model and reasoning effort'}),output=el('output',{},DEFAULT_ASSISTANT_PRESET.label);
 const paint=()=>{const p=ASSISTANT_PRESETS[Number(input.value)]??DEFAULT_ASSISTANT_PRESET;output.textContent=p.label;input.setAttribute('aria-valuetext',p.label);onChange(p,Number(input.value));};input.oninput=paint;
 const node=el('label',{class:'assistant-effort'},output,input);paint();
 return {node,input,get preset(){return ASSISTANT_PRESETS[Number(input.value)]??DEFAULT_ASSISTANT_PRESET;},set(model,effort){const i=ASSISTANT_PRESETS.findIndex(p=>p.model===model&&p.effort===effort);input.value=i<0?0:i;paint();}};
}
