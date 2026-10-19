import {el,button,replace,select,busy,toast,getDisplayTimeZone} from './ui.js';
import {prayerListText} from './prayer-plain.js';

function textOf(kind,data,section){
 if(kind==='prayer-list')return prayerListText(data.sections.map(s=>!section||s.id===section?s:{...s,nodes:[]}));
 return data.answers?.map(q=>q.prompt+'\n'+q.text).join('\n\n')||data.points?.map((s,i)=>`${i+1}. ${s}`).join('\n\n')||data.customText||[data.title,data.text,data.nextAction||data.nextStep,data.notes].filter(Boolean).join('\n\n')||JSON.stringify(data,null,2);
}
export function revisionHistory(ctx,{kind,id,onRestore=()=>{},canRestore=()=>true}){
 const body=el('div',{class:'form-stack'}),root=el('details',{class:'record-versions'},el('summary',{},'Earlier versions'),body);let current,items=[],next=null,loaded=false;
 async function load(before){const response=await ctx.request(`/api/revisions/${kind}/${encodeURIComponent(id)}${before?'?before='+before:''}`);current=response.current;items.push(...response.items);next=response.next;paint();}
 function paint(){
  replace(body,...items.map(item=>{const section=kind==='prayer-list'?select('Section',current.data.sections.map(s=>({value:s.id,label:s.title}))):null;
   const preview=el('pre',{class:'revision-preview'},textOf(kind,item.data,section?.input.value));if(section)section.input.onchange=()=>{preview.textContent=textOf(kind,item.data,section.input.value);};
   return el('details',{},el('summary',{},new Date(item.at).toLocaleString(undefined,{timeZone:getDisplayTimeZone()})+' · Version '+item.version),section?.node,preview,button('Restore these '+(kind==='prayer-list'?'requests':'words'),e=>busy(e.currentTarget,async()=>{
    if(!canRestore()){toast('Save or leave your current edits before restoring.');return;}
    if(!confirm('Restore this content? Current completion, dates and other sections will be preserved.'))return;
    const result=await ctx.request(`/api/revisions/${kind}/${encodeURIComponent(id)}`,{method:'POST',body:{mutationId:crypto.randomUUID(),auditId:item.id,version:current.version,...(section?{sectionId:section.input.value}:{})}});
    current=result.item;toast('Earlier content restored.');await onRestore(result.item);
   }),'quiet'));
  }),!items.length?el('p',{},'No earlier saved versions.'):null,next?button('Earlier',async e=>busy(e.currentTarget,()=>load(next)),'text-button'):null);
 }
 root.addEventListener('toggle',async()=>{if(root.open&&!loaded){loaded=true;try{await load();}catch(e){loaded=false;replace(body,el('p',{role:'alert'},e.message));}}});return root;
}
