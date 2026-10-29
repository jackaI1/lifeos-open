import {applyTimeFormat,timeFormatId} from './clock-format.js';
export {cachedTimeFormat} from './clock-format.js';
import {applyTheme,themeId,themes} from './themes.js';
import {customPalette,contrastRatio} from './custom-theme.js';
import {el,select,button,busy,toast,recordData} from './ui.js';
export function applyWorkspacePreferences(data={},root=document.documentElement){applyTimeFormat(data.timeFormat,root);applyTheme(data.theme,root,data.customTheme);root.dataset.textSize=data.textSize||'standard';root.dataset.controlDensity=data.controlDensity||'compact';root.dataset.handedness=data.handedness||'right';}
export function workspacePreferences(ctx){
 let record=ctx.records('settings').find(r=>r.id==='preferences');const data=record?.data??{},size=select('Text',[{value:'standard',label:'Standard'},{value:'large',label:'Larger'},{value:'largest',label:'Largest'}],data.textSize||'standard'),density=select('Controls',[{value:'compact',label:'Compact'},{value:'spacious',label:'Spacious'}],data.controlDensity||'compact'),hand=select('Writing hand',[{value:'right',label:'Right'},{value:'left',label:'Left'}],data.handedness||'right');
 return el('div',{class:'form-stack'},size.node,density.node,hand.node,button('Save display preferences',e=>busy(e.currentTarget,async()=>{record=ctx.records('settings').find(r=>r.id==='preferences');const next={...record?.data,textSize:size.input.value,controlDensity:density.input.value,handedness:hand.input.value},result=await ctx.save('settings',record||{id:'preferences',version:0},next);if(result.item){record=result.item;applyWorkspacePreferences(record.data);toast('Display preferences saved.');}else toast(result.reason);}), 'quiet'));
}

export function themeControl(ctx,{current=()=>true,getRecord=()=>ctx.records('settings').find(r=>r.id==='preferences'),onSaved=()=>{}}={}){
 let selected=themeId(recordData(getRecord()).theme),saving=false,editing=false,observer;
 const group=el('div',{class:'theme-grid','aria-busy':'false',role:'radiogroup','aria-label':'Theme'}),editor=el('div',{class:'theme-customizer',hidden:true}),customize=button('Customize',()=>openEditor(),'quiet'),root=el('div',{class:'theme-control'},el('h3',{},'Theme'),group,el('div',{class:'theme-actions'},customize),editor);
 const data=()=>recordData(getRecord()),restore=()=>applyTheme(selected,document.documentElement,data().customTheme);
 const closeEditor=()=>{editing=false;observer?.disconnect();editor.hidden=true;customize.hidden=false;};
 async function save(id,custom=data().customTheme){
  if(!current()||saving)return false;
  saving=true;group.setAttribute('aria-busy','true');root.setAttribute('aria-busy','true');for(const b of root.querySelectorAll('button'))b.disabled=true;
  try{const record=getRecord(),result=await ctx.save('settings',record||{id:'preferences',version:0},{...recordData(record),theme:id,customTheme:custom??null});if(!result.item)throw Error(result.reason||'Theme could not be saved.');selected=id;onSaved(result.item);applyTheme(id,document.documentElement,result.item.data.customTheme);return true;}
  catch(error){restore();if(current())toast(error.message);return false;}
  finally{saving=false;group.setAttribute('aria-busy','false');root.removeAttribute('aria-busy');for(const b of root.querySelectorAll('button'))b.disabled=false;}
 }
 async function choose(id){if(editing||saving||id===selected)return;const keepFocus=group.contains(document.activeElement);if(await save(id)){paint();toast('Theme saved.');}if(keepFocus&&current())group.querySelector('[aria-checked=true]')?.focus();}
 function paint(){
  const custom=data().customTheme,palettes=[...themes];if(custom)palettes.push(customPalette(custom));
  const tiles=palettes.map((theme,index)=>{
   const tile=el('button',{type:'button',class:'theme-key',role:'radio','aria-label':theme.name,'aria-checked':String(theme.id===selected),tabindex:theme.id===selected?'0':'-1',onclick:()=>choose(theme.id)},el('span',{class:'theme-mini','aria-hidden':'true'},el('span',{class:'theme-mini-display'},el('i')),el('span',{class:'theme-mini-primary'})),el('span',{class:'theme-name'},theme.name));
   for(const [key,value]of Object.entries({chassis:theme.chassis,display:theme.display,ink:theme.displayInk,label:theme.ink,primary:theme.primary}))tile.style.setProperty('--preview-'+key,value);
   tile.onkeydown=event=>{const step={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[event.key];if(step||event.key==='Home'||event.key==='End'){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tiles.length-1:(index+step+tiles.length)%tiles.length;for(const key of tiles)key.tabIndex=-1;tiles[next].tabIndex=0;tiles[next].focus();}if(event.key==='Enter'||event.key===' '){event.preventDefault();void choose(theme.id);}};return tile;
  });group.replaceChildren(...tiles);
 }
 function openEditor(){
  if(saving||!current())return;
  const stored=data().customTheme,base=themes.find(t=>t.id===(selected==='custom'?stored.base:selected)),draft=selected==='custom'?{...stored}:{base:base.id,name:'Custom',primary:base.primary,display:base.display,chassis:base.chassis};
  editing=true;customize.hidden=true;editor.hidden=false;editor.replaceChildren(el('h4',{},'Customize '+base.name));
  const name=el('input',{type:'text',value:draft.name,maxlength:'40','aria-label':'Theme name'}),notice=el('p',{class:'muted',role:'status'}),swatches=el('div',{class:'accent-swatches','aria-label':'Accent swatches'});
  const preview=()=>{applyTheme('custom',document.documentElement,draft,{persist:false});const p=customPalette(draft);notice.textContent='Text contrast is protected automatically. Display '+contrastRatio(p.displayInk,p.display).toFixed(1)+':1 · Chassis '+contrastRatio(p.ink,p.chassis).toFixed(1)+':1';};
  editor.append(el('label',{},el('span',{},'Theme name'),name));
  const colourInputs={};for(const [key,label]of [['primary','Accent colour'],['display','Display colour'],['chassis','Chassis tone']]){const input=el('input',{type:'color',value:draft[key],'aria-label':label,oninput:()=>{draft[key]=input.value;preview();}});colourInputs[key]=input;editor.append(el('label',{class:'theme-colour'},el('span',{},label),input));if(key==='primary')editor.append(swatches);}
  for(const colour of ['#E8B34B','#7FA6F5','#6ED6C4','#B89AF2','#EF8FA6','#F28E5E','#85C874','#E7EBF3']){const swatch=button('',()=>{draft.primary=colour;colourInputs.primary.value=colour;preview();},'accent-swatch');swatch.style.setProperty('--swatch',colour);swatch.setAttribute('aria-label','Accent '+colour);swatches.append(swatch);}
  const saveButton=button('Save theme',async()=>{if(!name.value.trim()){name.setCustomValidity('Enter a theme name.');name.reportValidity();return;}draft.name=name.value.trim();if(await save('custom',draft)){closeEditor();paint();toast('Custom theme saved.');customize.focus();}}),cancel=button('Cancel',()=>{closeEditor();restore();customize.focus();},'quiet');name.oninput=()=>name.setCustomValidity('');
  const actions=el('div',{class:'actions'},saveButton,cancel);if(selected==='custom')actions.append(button('Reset to '+base.name,async()=>{if(await save(base.id,null)){closeEditor();paint();toast('Reset to '+base.name+'.');customize.focus();}},'quiet'));
  editor.append(notice,actions);preview();observer=new MutationObserver(()=>{if(editing&&!root.isConnected){observer.disconnect();editing=false;restore();}});observer.observe(document.body,{childList:true,subtree:true});name.focus();
 }
 paint();return root;
}

export function timeFormatControl(ctx,{current=()=>true,getRecord=()=>ctx.records('settings').find(r=>r.id==='preferences'),onSaved=()=>{},onApplied=()=>{}}={}){
 let selected=timeFormatId(recordData(getRecord()).timeFormat),saving=false;
 const values=['24h','12h'],group=el('div',{class:'theme-grid time-format-options',role:'radiogroup','aria-label':'Time format'}),keys=[];
 const paint=()=>{group.setAttribute('aria-busy',String(saving));for(const [i,key]of keys.entries()){key.setAttribute('aria-checked',String(values[i]===selected));key.tabIndex=values[i]===selected?0:-1;key.disabled=saving;}};
 async function choose(id){
  if(!current()||saving||selected===id)return;
  const previous=selected;selected=id;saving=true;applyTimeFormat(id);onApplied();paint();
  try{const record=getRecord(),result=await ctx.save('settings',record||{id:'preferences',version:0},{...recordData(record),timeFormat:id});if(!result.item)throw Error(result.reason||'Time format could not be saved.');onSaved(result.item);}
  catch(error){selected=previous;if(document.documentElement.dataset.timeFormat===id){applyTimeFormat(previous);onApplied();}if(current())toast(error.message);}
  finally{saving=false;if(current())paint();}
 }
 for(const [i,id]of values.entries()){
  const key=el('button',{type:'button',class:'theme-key',role:'radio',onclick:()=>choose(id)},i===0?'24-hour (13:30)':'12-hour (1:30 PM)');
  key.onkeydown=e=>{const step={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[e.key];if(step||e.key==='Home'||e.key==='End'){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?1:(i+step+2)%2;keys[next].focus();return choose(values[next]);}if(e.key==='Enter'||e.key===' '){e.preventDefault();return choose(id);}};
  keys.push(key);group.append(key);
 }
 paint();return el('div',{class:'time-format-control'},el('h3',{},'Time format'),group);
}
