import {el,button,modal,replace} from './ui.js';
export function actionResults(records,query){
 const q=query.trim().toLowerCase(),items=[];
 const rules={'private-note':r=>'notes?entry='+encodeURIComponent(r.id),'learning-note':r=>'school?learning='+encodeURIComponent(r.data.courseId),task:r=>'school?task='+encodeURIComponent(r.id),course:r=>'school?lectures='+encodeURIComponent(r.id),project:r=>'tickets?project='+encodeURIComponent(r.id),reminder:r=>'reminders?list='+encodeURIComponent(r.data.listId||'')+'&reminder='+encodeURIComponent(r.id),devotional:r=>'devotional?day='+encodeURIComponent(r.data.date||'')+'&entry='+encodeURIComponent(r.id),coursework:r=>'school?task='+encodeURIComponent(r.data.taskId||'')};
 for(const[kind,target]of Object.entries(rules))for(const r of records[kind]??[]){const d=r.data??{};if(d.archived)continue;const label=d.title||d.passage||d.code;if(label&&(!q||`${label} ${d.courseCode||''}`.toLowerCase().includes(q)))items.push({label,target:target(r),kind});}
 return items.sort((a,b)=>a.label.localeCompare(b.label)).slice(0,30);
}
export function openActionFinder(ctx,routes){
 let records={...ctx.state.bootstrap.records};
 const input=el('input',{type:'search',placeholder:'Find a record or page','aria-label':'Find a record or page',autocomplete:'off'}),results=el('div',{class:'finder-results'});
 const commands=[...routes.map(([target,label])=>({target,label})),{target:'settings?section=recovery',label:'Recover unsent work'},{target:'school?lectures=all',label:'Live notes'},{target:'settings?section=display',label:'Text size and writing hand'},{target:'prayer?view=journal',label:'Prayer journal'}];
 function render(){const q=input.value.trim().toLowerCase(),matches=[...commands.filter(c=>!q||c.label.toLowerCase().includes(q)),...actionResults(records,q)];replace(results,...matches.map(m=>button(m.label,()=>{document.querySelector('#dialog').close();ctx.go(m.target);},'text-button')),matches.length?null:el('p',{},'No matching saved title.'));}
 input.oninput=render;input.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();results.querySelector('button')?.focus();}if(e.key==='Enter')results.querySelector('button')?.click();};
 results.onkeydown=e=>{if(!['ArrowDown','ArrowUp'].includes(e.key))return;e.preventDefault();const buttons=[...results.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();};render();modal('Find in LifeOS',el('div',{class:'form-stack'},input,results));input.focus({preventScroll:true});
 void Promise.all([ctx.request('/api/devotionals'),ctx.request('/api/learning-notes'),ctx.request('/api/private-notes?offset=0&q=')]).then(([d,l,n])=>{records={...records,devotional:d.entries.map(e=>({id:e.id,data:e})),'learning-note':l.items,'private-note':n.items};if(input.isConnected)render();}).catch(()=>{});
}
