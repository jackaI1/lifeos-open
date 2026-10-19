import {el,button,field,select,modal,replace} from './ui.js';
import {controlIcon} from './quiet-controls.js';

export function courseDeckOptions(items,query=''){
 const words=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 return items.filter(r=>words.every(w=>(r.data.title+' '+(r.data.section??'')).toLocaleLowerCase().includes(w)))
  .map(r=>({value:r.id,label:(r.data.section?r.data.section+', ':'')+r.data.title}));
}
export async function openCourseDeckPicker({ctx,id,onAttach,onOther}){
 const body=el('div',{class:'form-stack'}),status=el('p',{role:'status'}),list=el('div'),search=field('Find a PDF',{type:'search',placeholder:'Title or folder'}),first=field('First slide',{type:'number',min:1,max:2000}),last=field('Last slide',{type:'number',min:1,max:2000});
 const range=el('details',{},el('summary',{},'Use part of this deck'),el('div',{class:'field-grid'},first.node,last.node));
 let items=[],busy=false,selected=null;
 const add=button('Add deck',async()=>{if(busy||!selected)return;busy=true;add.disabled=true;status.textContent='Adding deck…';try{
  const item=items.find(r=>r.id===selected),result=await ctx.request('/api/lectures/'+id+'/sources/'+'course',{method:'POST',body:{sourceId:item.id,...(first.input.value||last.input.value?{pageRange:{from:Number(first.input.value),through:Number(last.input.value)}}:item.data.pageRange?{pageRange:item.data.pageRange}:{}),mutationId:crypto.randomUUID()}});
  await onAttach(result.item);document.querySelector('#dialog').close();
 }catch(e){status.textContent=e.message;}finally{busy=false;add.disabled=!selected;}});
 function render(){const options=courseDeckOptions(items,search.input.value);selected=options.some(x=>x.value===selected)?selected:options[0]?.value??null;const choice=select('Course PDF',options,selected??'');choice.input.onchange=()=>{selected=choice.input.value;add.disabled=!selected;};replace(list,...(options.length?[choice.node]:[el('p',{},'No matching PDFs.')]));add.disabled=busy||!selected;}
 async function load(){busy=true;add.disabled=true;try{const result=await ctx.request('/api/lectures/'+id+'/sources/catalog');items=result.items??[];status.textContent='';}catch(e){status.textContent=e.message;}finally{busy=false;render();}}
 search.input.oninput=render;
 body.append(search.node,list,range,add,status,button('Attach another private PDF',()=>onOther(),'text-button'));
 modal('Course PDFs',body);await load();
}
