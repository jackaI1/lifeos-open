import {el,button,select,field} from './ui.js';
import {controlIcon} from './quiet-controls.js';
import {nextContactDay} from './friend-schedule.js';
export const privateIcon=(label,name,action)=>{const b=button(controlIcon(name),action,'quiet icon-button');b.setAttribute('aria-label',label);b.title=label;return b;};
const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function contactScheduleEditor(data,day){
 const frequency=select('Repeat',[{value:'none',label:'Once'},{value:'weekly',label:'Weekly'},{value:'monthly',label:'Monthly'}],data.schedule?.frequency??'none');
 const weekday=select('Weekday',weekdays.map((label,i)=>({value:String(i),label})),String(data.schedule?.weekday??1));
 const ordinal=select('Which week',[{value:'1',label:'First'},{value:'2',label:'Second'},{value:'3',label:'Third'},{value:'4',label:'Fourth'},{value:'5',label:'Fifth'},{value:'-1',label:'Last'}],String(data.schedule?.ordinal??1));
 const due=field('Next check-in',{type:'date',value:data.dueDay&&data.dueDay>day?data.dueDay:day});
 const value=()=>({schedule:{frequency:frequency.input.value,...(frequency.input.value!=='none'?{weekday:Number(weekday.input.value)}:{}),...(frequency.input.value==='monthly'?{ordinal:Number(ordinal.input.value)}:{})},dueDay:due.input.value||null});
 const paint=()=>{weekday.node.hidden=frequency.input.value==='none';ordinal.node.hidden=frequency.input.value!=='monthly';};
 for(const control of [frequency,weekday,ordinal])control.input.onchange=()=>{paint();if(frequency.input.value!=='none')due.input.value=nextContactDay(value().schedule,day,{inclusive:true});};paint();return {node:el('div',{class:'contact-schedule-form'},frequency.node,ordinal.node,weekday.node,due.node),value};
}
