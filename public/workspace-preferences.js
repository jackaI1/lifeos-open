import {applyTheme,themeId,themes} from './themes.js';
import {el,select,button,busy,toast,recordData} from './ui.js';
export function applyWorkspacePreferences(data={},root=document.documentElement){applyTheme(data.theme,root);root.dataset.textSize=data.textSize||'standard';root.dataset.controlDensity=data.controlDensity||'compact';root.dataset.handedness=data.handedness||'right';}
export function workspacePreferences(ctx){
 let record=ctx.records('settings').find(r=>r.id==='preferences');const data=record?.data??{},size=select('Text',[{value:'standard',label:'Standard'},{value:'large',label:'Larger'},{value:'largest',label:'Largest'}],data.textSize||'standard'),density=select('Controls',[{value:'compact',label:'Compact'},{value:'spacious',label:'Spacious'}],data.controlDensity||'compact'),hand=select('Writing hand',[{value:'right',label:'Right'},{value:'left',label:'Left'}],data.handedness||'right');
 return el('div',{class:'form-stack'},size.node,density.node,hand.node,button('Save display preferences',e=>busy(e.currentTarget,async()=>{record=ctx.records('settings').find(r=>r.id==='preferences');const next={...record?.data,textSize:size.input.value,controlDensity:density.input.value,handedness:hand.input.value},result=await ctx.save('settings',record||{id:'preferences',version:0},next);if(result.item){record=result.item;applyWorkspacePreferences(record.data);toast('Display preferences saved.');}else toast(result.reason);}), 'quiet'));
}

export function themeControl(ctx,{current=()=>true,getRecord=()=>ctx.records('settings').find(r=>r.id==='preferences'),onSaved=()=>{}}={}){
 let selected=themeId(recordData(getRecord()).theme),saving=false;
 const group=el('div',{class:'theme-grid',role:'radiogroup','aria-label':'Theme'}),tiles=[];
 const paint=()=>{group.setAttribute('aria-busy',String(saving));for(const [index,tile]of tiles.entries()){tile.setAttribute('aria-checked',String(themes[index].id===selected));tile.tabIndex=themes[index].id===selected?0:-1;tile.setAttribute('aria-disabled',String(saving));}};
 async function choose(id){
  if(!current()||saving||id===selected)return;
  const previous=selected;selected=id;saving=true;applyTheme(id);paint();
  try{
   const record=getRecord(),result=await ctx.save('settings',record||{id:'preferences',version:0},{...recordData(record),theme:id});
   if(!result.item)throw Error(result.reason||'Theme could not be saved.');
   onSaved(result.item);
  }catch(error){
   selected=previous;
   // A late failure must not replace a more recent choice from another view.
   if(document.documentElement.dataset.theme===id)applyTheme(previous);
   if(current())toast(error.message);
  }finally{saving=false;if(current())paint();}
 }
 for(const [index,theme]of themes.entries()){
  const tile=el('button',{type:'button',class:'theme-key',role:'radio','aria-label':theme.name,onclick:()=>choose(theme.id)},
   el('span',{class:'theme-mini','aria-hidden':'true'},el('span',{class:'theme-mini-display'},el('i')),el('span',{class:'theme-mini-primary'})),el('span',{class:'theme-name'},theme.name));
  for(const [key,value]of Object.entries({chassis:theme.chassis,display:theme.display,ink:theme.displayInk,label:theme.ink,primary:theme.primary}))tile.style.setProperty('--preview-'+key,value);
  tile.onkeydown=event=>{
   const step={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[event.key];
   if(step||event.key==='Home'||event.key==='End'){
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tiles.length-1:(index+step+tiles.length)%tiles.length;
    for(const key of tiles)key.tabIndex=-1;tiles[next].tabIndex=0;tiles[next].focus();
   }
   if(event.key==='Enter'||event.key===' '){event.preventDefault();return choose(theme.id);}
  };
  tiles.push(tile);group.append(tile);
 }
 paint();return el('div',{class:'theme-control'},el('h3',{},'Theme'),group);
}
