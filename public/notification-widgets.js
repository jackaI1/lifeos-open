import {el,button,icon,replace,modal} from './ui.js';

// Alerts keep their original action. A collapsed stack is only an expand key.
export function notificationWidgets(items,{className=''}={}){
 const node=el('section',{class:'notification-widgets '+className,'aria-label':'Notifications'});
 let expanded=false,sheet=null;
 function card(item,activate=item.activate,stack=false){
  const content=[el('span',{class:'annunciator-led','aria-hidden':'true'}),el('span',{class:'annunciator-copy'},el('span',{class:'annunciator-title'},item.title),item.body?el('span',{class:'annunciator-body'},item.body):null)];
  const key=item.href&&!stack?el('a',{href:item.href,target:'_blank',rel:'noopener noreferrer'},content):button(content,activate,'quiet');
  key.className='quiet annunciator-card'+(['error','blocked','overdue'].includes(item.severity)?' annunciator-error':'')+(stack?' notification-stack':'');
  key.setAttribute('title',item.title);
  if(stack){key.setAttribute('aria-label',items.length+' notifications: '+item.title);key.setAttribute('aria-expanded','false');}
  return key;
 }
 function paint(){
  if(items.length>1&&!expanded)replace(node,el('div',{class:'notification-pile'},Array.from({length:Math.min(2,items.length-1)},(_,i)=>el('span',{class:'notification-plate notification-plate-'+(i+1),'aria-hidden':'true'})),card(items[0],()=>{expanded=true;paint();node.querySelector('.annunciator-card')?.focus({preventScroll:true});},true)));
  else{
   const less=items.length>1?button('Show less',()=>{expanded=false;paint();node.querySelector('.notification-stack')?.focus({preventScroll:true});},'quiet compact notifications-less'):null;
   replace(node,items.map(item=>card(item)),less);
  }
 }
 const openSheet=()=>{
  sheet=el('div',{class:'notification-sheet'},items.map(item=>card(item,()=>{document.querySelector('#dialog')?.close();item.activate?.();})));
  modal('Notifications',sheet);
 };
 const bell=button([icon('reminders'),el('span',{class:'notification-count','aria-hidden':'true'},items.length)],openSheet,'quiet icon-button notification-bell');
 bell.setAttribute('aria-label','Notifications ('+items.length+')');bell.setAttribute('title','Notifications');bell.hidden=!items.length;node.hidden=!items.length;
 paint();
 return {node,bell,open:openSheet,destroy(){const dialog=document.querySelector('#dialog');if(sheet&&dialog?.open&&dialog.contains(sheet))dialog.close();sheet=null;}};
}
