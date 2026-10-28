import {el,formatTime,formatDate,button} from './ui.js';

export function currentScheduleDetails(item,view,ctx){
 if(item.state!=='current')return null;
 const now=Date.parse(view.now||ctx.state.bootstrap.now),end=Date.parse(item.end),action=view.nowAction||{};
 const same=action.id===item.id||action.kind===item.kind&&action.start===item.start;
 const evidence=same?action.evidence:null;
 const event=item.target?.eventId?view.calendar?.events?.find(e=>e.id===item.target.eventId):null;
 const remainingMinutes=Number.isFinite(end)&&Number.isFinite(now)?Math.max(0,Math.ceil((end-now)/60000)):null;
 const texts=[remainingMinutes!==null?'Until '+formatTime(item.end)+', '+remainingMinutes+' min left':null,item.notes,item.detail,same?(evidence?.rule||action.reason):null,same?action.detail:null,evidence?.deadline?'Due '+formatDate(evidence.deadline)+' '+formatTime(evidence.deadline):null,evidence?.availableMinutes&&Number(evidence.availableMinutes)!==remainingMinutes?evidence.availableMinutes+' min available':null].filter(text=>text&&text!==event?.location);
 const taskId=item.taskId||item.target?.taskId,task=taskId?ctx.records('task').find(t=>t.id===taskId):null,data=task?.data;
 const checklist=item.checklist||data?.checklist||[];
 return el('div',{class:'schedule-current-details'},[...new Set(texts)].map(text=>el('p',{},text)),data?button(data.title+(data.dueAt||data.dueDate?', Due '+formatDate(data.dueAt||data.dueDate):''),()=>ctx.go('school?brief='+encodeURIComponent(task.id)),'text-button'):null,Array.isArray(checklist)&&checklist.length?el('ul',{},checklist.map(point=>el('li',{},typeof point==='string'?point:point.text||point.title||''))):null);
}
export function selectScheduleRow(host,shown,{scroll=false}={}){
 let selected;
 for(const row of host.querySelectorAll('.story-item')){
  const match=!!shown&&(shown.id?row.getAttribute('data-schedule-id')===shown.id:row.getAttribute('data-schedule-start')===shown.start&&row.getAttribute('data-schedule-kind')===shown.kind);
  if(match){row.classList.add('story-selected');row.setAttribute('aria-selected','true');selected=row;}
  else{row.classList.remove('story-selected');row.removeAttribute('aria-selected');}
 }
 if(scroll&&selected){const box=selected.getBoundingClientRect(),height=window.visualViewport?.height??window.innerHeight;if(box.top<0||box.bottom>height)selected.scrollIntoView({block:'nearest',behavior:'instant'});}
 return selected;
}
