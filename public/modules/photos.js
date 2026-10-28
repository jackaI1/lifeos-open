import {trashEntryButton} from '../deleted.js';
import {el,replace,button,heading,field,icon,busy,errorNotice,formatDate,modal,download,toast} from '../ui.js';
import {PrivateStore} from '../storage.js';
import {MomentDraft} from '../private-moment-draft.js';
import {prepareDailyPhoto} from '../daily-photo-image.js';
import {syncControl,controlIcon} from '../quiet-controls.js';
import {routeQuery} from '../targets.js';
export async function mount(root,ctx){
 const store=new PrivateStore({name:'lifeos-private-photos-v1'});let dead=false,draft=null,loading=false,release=()=>{};
 const host=el('div',{class:'private-moments daily-photos'}),errors=el('div',{role:'status'});replace(root,host);
 const showError=e=>replace(errors,errorNotice(e));
 async function listing(){
  const input=el('input',{type:'file',accept:'image/*',hidden:true,'aria-label':'Choose a daily photo'}),add=button(el('span',{class:'icon-label'},controlIcon('camera'),'Add photo'),()=>input.click());
  input.onchange=async()=>{const file=input.files?.[0];if(!file)return;loading=true;add.disabled=true;try{const photo=await prepareDailyPhoto(file),id=crypto.randomUUID(),value={data:{day:ctx.date(),caption:''},photo,version:0,dirty:true,pending:null};const durable=await store.put('photo:'+id,value);if(!durable)throw Error('There is not enough browser storage. The original photo remains on your phone.');ctx.go('photos?photo='+id);}catch(e){showError(e);}finally{loading=false;add.disabled=false;input.value='';}};
  const grid=el('div',{class:'daily-photo-grid'});replace(host,heading('Daily photos'),add,input,errors,grid);let offset=0;
  const pending=(await store.list('photo:')).filter(r=>r.value.dirty||r.value.pending);for(const r of pending){const image=r.value.photo?.thumbnail??r.value.pending?.photo?.thumbnail;grid.append(button(el('span',{},image?el('img',{src:image,alt:'Photo saved on this device'}):null,el('small',{},formatDate(r.value.data.day)+', On this device')),()=>ctx.go('photos?photo='+r.key.slice(6)),'daily-photo-thumb quiet'));}
  const load=async()=>{try{const result=await ctx.request('/api/daily-photos?offset='+offset);if(dead)return;host.querySelector('.more-photos')?.remove();for(const r of result.items){const thumb=button(el('span',{},el('img',{src:'/api/daily-photos/'+r.id+'/image?size=thumbnail',alt:r.data.caption||'Photo from '+formatDate(r.data.day),loading:'lazy'}),el('small',{},formatDate(r.data.day)),r.data.caption?el('span',{class:'daily-photo-caption'},r.data.caption):null),()=>ctx.go('photos?photo='+r.id),'daily-photo-thumb quiet');grid.append(thumb);}const reading=host.querySelector('.display-reading');if(reading){reading.hidden=false;reading.textContent=grid.children.length+' photos';}offset=result.nextOffset;if(offset!==null)host.append(button('Earlier photos',e=>busy(e.currentTarget,load),'text-button more-photos'));if(!grid.children.length)grid.append(el('p',{class:'empty'},'A photo whenever you want to remember the day.'));}catch(e){replace(errors,errorNotice(e),button('Retry',load,'text-button'));}};await load();
 }
 async function editor(id){
  const local=await store.get('photo:'+id);let item=null;if(!local?.dirty&&!local?.pending){item=(await ctx.request('/api/daily-photos/'+id)).item;item={...item,data:{day:item.data.day,caption:item.data.caption}};}
  const status=syncControl(()=>draft.save().catch(showError));release=status.destroy;const save=button('Save',e=>busy(e.currentTarget,()=>draft.save().catch(showError)));
  draft=new MomentDraft({store,request:ctx.request,key:'photo:'+id,path:'/api/daily-photos/'+id,changed:d=>{if(dead)return;save.disabled=!!d.saving;status.update({mode:d.error||!d.durable?'alert':d.value?.dirty?'device':'cloud',detail:!d.durable?'Keep this page open. Browser storage is unavailable.':d.error?.message??(d.value?.dirty?'Photo on this device. Save to sync across devices.':null),retry:!!d.value?.dirty,updatedAt:d.value?.updatedAt});}});
  const value=await draft.open(item),source=value.photo?.image??value.pending?.photo?.image??'/api/daily-photos/'+id+'/image';
  const img=el('img',{src:source,alt:value.data.caption||'Daily photo',class:'daily-photo-preview'}),day=field('Day',{type:'date',value:value.data.day}),caption=field('Caption',{multiline:true,value:value.data.caption,placeholder:'Optional',maxlength:4000,rows:3}),back=button(icon('left'),()=>ctx.go('photos'),'quiet icon-button');back.setAttribute('aria-label','Back to daily photos');
  const replacement=el('input',{type:'file',accept:'image/*',hidden:true,'aria-label':'Replace daily photo'}),replacePhoto=button('Replace photo',()=>replacement.click(),'quiet');replacement.onchange=async()=>{const file=replacement.files?.[0];if(!file)return;try{const photo=await prepareDailyPhoto(file);await draft.edit(draft.value.data,photo);img.src=photo.image;}catch(e){showError(e);}finally{replacement.value='';}};
  const expand=button(img,()=>{modal('Photo',el('img',{class:'daily-photo-expanded',src:img.src,alt:caption.input.value||'Daily photo'}));},'daily-photo-expand');expand.setAttribute('aria-label','Expand photo');
  replace(host,heading('Daily photo',null,back,formatDate(value.data.day)),expand,replacePhoto,replacement,el('div',{class:'moment-fields'},day.node,caption.node),el('div',{class:'moment-save actions'},status.node,save,trashEntryButton(ctx,()=>({kind:'private-daily-photo',id,version:draft.value.version}),async()=>{await store.remove('photo:'+id);ctx.go('photos');},()=>{if(draft.value.dirty||draft.saving){toast('Save your photo changes before deleting.');return false;}return true;})),errors);
  const edit=()=>void draft.edit({day:day.input.value,caption:caption.input.value});day.input.addEventListener('change',edit);caption.input.addEventListener('input',edit);
  if(value.pending&&navigator.onLine)void draft.save().catch(showError);
 }
 try{const id=routeQuery().get('photo');if(id)await editor(id);else await listing();}catch(e){showError(e);if(!errors.isConnected)host.append(errors);}
 const online=()=>{if(draft?.value?.pending)void draft.save().catch(showError);};window.addEventListener('online',online);
 return {dirty:()=>loading||!!draft?.value?.dirty,async beforeLeave(){if(loading)return false;if(draft&&!await draft.canLeave()){showError(Error('Keep this page open until your photo is saved.'));return false;}return true;},destroy(){dead=true;release();window.removeEventListener('online',online);}};
}
