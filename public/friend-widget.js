import {el,replace,button,modal,busy,toast} from './ui.js';
import {privateIcon,contactScheduleEditor} from './friend-controls.js';
export function friendWidget(ctx){
 const node=el('section',{class:'friend-checkins',hidden:true,'aria-label':'Keep in touch'});let dead=false,working=false;
 async function load(){if(working||dead)return;working=true;try{const result=await ctx.request('/api/private-friends/due');if(dead)return;replace(node);node.hidden=!result.items.length;if(result.items.length)node.append(el('h2',{},'Keep in touch'));
 for(const item of result.items){const open=button(item.data.name,()=>ctx.go('friends?entry='+item.id),'text-button friend-open');const edit=privateIcon('Reschedule '+item.data.name,'pen',async()=>{try{const {item:latest}=await ctx.request('/api/private-friends/'+item.id),form=contactScheduleEditor(latest.data,result.day);modal('Keep in touch',el('div',{},form.node,button('Save',e=>busy(e.currentTarget,async()=>{try{await ctx.request('/api/private-friends/'+latest.id,{method:'PUT',body:{version:latest.version,mutationId:crypto.randomUUID(),data:{...latest.data,...form.value()}}});document.querySelector('#dialog').close();void load();}catch(e){toast(e.message);}}))));}catch(e){toast(e.message);}});
 const complete=privateIcon('Mark check-in with '+item.data.name+' complete','check',e=>busy(e.currentTarget,async()=>{try{await ctx.request('/api/private-friends/'+item.id+'/complete',{method:'POST',body:{version:item.version,mutationId:crypto.randomUUID()}});void load();}catch(e){toast(e.message);}}));node.append(el('div',{class:'friend-checkin'},open,edit,complete));}
 if(result.more)node.append(button('All friends',()=>ctx.go('friends'),'text-button'));
 }catch{if(!dead){node.hidden=false;replace(node,button('Retry friend reminders',load,'text-button'));}}finally{working=false;}}
 void load();return {node,load,destroy(){dead=true;}};
}
