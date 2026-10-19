import {el,button,field,select,modal,replace} from './ui.js';
import {controlIcon} from './quiet-controls.js';

export function mergeCourseDecks(saved,live){
 const key=r=>r.data.fileId+':'+r.data.md5,seen=new Set(live.map(key));
 return [...live.map(r=>({...r,attachRoute:'drive-course',data:{...r.data,...(saved.find(s=>key(s)===key(r)&&s.data.pageRange)?.data.pageRange?{pageRange:saved.find(s=>key(s)===key(r)&&s.data.pageRange).data.pageRange}:{})}})),...saved.filter(r=>!seen.has(key(r))).map(r=>({...r,attachRoute:'course',data:{...r.data,section:r.data.section??'Saved course PDFs'}}))];
}
export function courseDeckOptions(items,query=''){
 const words=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 return items.filter(r=>words.every(w=>(r.data.title+' '+(r.data.section??'')).toLocaleLowerCase().includes(w)))
  .map(r=>({value:r.id,label:(r.data.section?r.data.section+' · ':'')+r.data.title}));
}
export async function openCourseDeckPicker({ctx,id,onAttach,onOther}){
 const body=el('div',{class:'form-stack'}),status=el('p',{role:'status'}),list=el('div'),search=field('Find a PDF',{type:'search',placeholder:'Title or folder'}),first=field('First slide',{type:'number',min:1,max:2000}),last=field('Last slide',{type:'number',min:1,max:2000});
 const range=el('details',{},el('summary',{},'Use part of this deck'),el('div',{class:'field-grid'},first.node,last.node));
 let items=[],saved=[],live=[],token=null,busy=false,selected=null;
 const more=button('More files',()=>void load(true),'text-button');more.hidden=true;
 const refresh=button(controlIcon('retry'),()=>void load(false),'quiet icon-button');refresh.setAttribute('aria-label','Refresh course Drive');
 const link=el('a',{target:'_blank',rel:'noopener',hidden:true},'Open course folder');
 const add=button('Add deck',async()=>{if(busy||!selected)return;busy=true;add.disabled=true;status.textContent='Adding deck…';try{
  const item=items.find(r=>r.id===selected),result=await ctx.request('/api/lectures/'+id+'/sources/'+item.attachRoute,{method:'POST',body:{...(item.attachRoute==='drive-course'?{fileId:item.data.fileId,md5:item.data.md5}:{sourceId:item.id}),...(first.input.value||last.input.value?{pageRange:{from:Number(first.input.value),through:Number(last.input.value)}}:item.data.pageRange?{pageRange:item.data.pageRange}:{}),mutationId:crypto.randomUUID()}});
  await onAttach(result.item);document.querySelector('#dialog').close();
 }catch(e){status.textContent=e.message;}finally{busy=false;add.disabled=!selected;}});
 function render(){const options=courseDeckOptions(items,search.input.value);selected=options.some(x=>x.value===selected)?selected:options[0]?.value??null;const choice=select('Course PDF',options,selected??'');choice.input.onchange=()=>{selected=choice.input.value;add.disabled=!selected;};replace(list,...(options.length?[choice.node]:[el('p',{},'No matching PDFs.')]));add.disabled=busy||!selected;}
 async function load(append=false){if(busy)return;busy=true;add.disabled=true;refresh.disabled=true;more.disabled=true;status.textContent='Loading course Drive…';try{
  if(!append){const previous=await ctx.request('/api/lectures/'+id+'/sources/catalog');saved=previous.items??[];}
  const result=await ctx.request('/api/lectures/'+id+'/sources/drive-catalog'+(append&&token?'?pageToken='+encodeURIComponent(token):''));live=append?[...live,...result.items.filter(r=>!live.some(x=>x.id===r.id))]:result.items;token=result.nextPageToken;more.hidden=!token;link.href=result.folderUrl;link.hidden=false;status.textContent=result.partial?'Some Drive files could not be listed. Refresh to try again.':'';
 }catch(e){status.textContent=e.message+(saved.length?' Saved course PDFs remain available.':'');}finally{items=mergeCourseDecks(saved,live);busy=false;refresh.disabled=false;more.disabled=false;render();}}
 search.input.oninput=render;
 body.append(el('div',{class:'actions'},link,refresh),search.node,list,more,range,add,status,button('Attach another private PDF',()=>onOther(),'text-button'));
 modal('Course Drive',body);await load();
}
