import {el,button} from './ui.js';

const paths={clock:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 6v6l4 2',pause:'M8 5v14 M16 5v14',play:'m7 4 13 8-13 8V4z',usage:'M3 17a9 9 0 1 1 18 0 M12 13l5-5 M4 17h16 M7 7l1 1 M12 4v2 M17 7l-1 1',effort:'M9 18h6 M10 21h4 M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2',location:'M12 2a8 8 0 0 0-8 8c0 6 8 12 8 12s8-6 8-12a8 8 0 0 0-8-8 M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',lasso:'M19 6c-7-7-19 0-14 8 4 6 17 2 15-5 M7 16c-5 3-1 7 2 4',copy:'M8 8h13v13H8z M16 8V3H3v13h5',duplicate:'M8 8h13v13H8z M16 8V3H3v13h5 M11 14h7 M14.5 10.5v7',removeBackground:'M3 3h18v18H3z M3 21 21 3 M4 10h4 M4 15h4 M9 16v4 M14 12v8',eyedropper:'m15 3 6 6 M14 4l6 6 M15 7 5 17l-1 3 3-1L17 9 M4 20l-1 1',paste:'M8 5H5v16h14V5h-3 M9 3h6v4H9z M8 13h8 M8 17h6',walk:'M14 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0 M10 8l3-1 2 5 4 2 M10 8l-3 5 M12 8l-1 7-4 6 M11 15l5 6',bus:'M5 17V6q0-3 7-3t7 3v11H5 M5 10h14 M8 17v3 M16 17v3 M8 14h.1 M16 14h.1',sidebar:'M3 4h18v16H3z M9 4v16',newChat:'M14 4H4v16h16V10 M10 14l1-4 8-8 3 3-8 8-4 1',camera:'M3 6h4l2-3h6l2 3h4v15H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',image:'M3 3h18v18H3z M3 17l6-6 5 5 3-3 4 4 M16 7h.1',expand:'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M3 16v5h5',bookmark:'M6 3h12v18l-6-4-6 4V3z',study:'M3 5h7l2 2 2-2h7v15h-7l-2 2-2-2H3V5z M12 7v15',close:'M6 6l12 12 M18 6 6 18',graph:'M4 3v17h17 M4 20 20 4 M9 18v4 M14 18v4 M2 10h4 M2 15h4',trash:'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 10v7 M14 10v7',drag:'M4 6h16 M4 12h16 M4 18h16',bulletList:'M9 6h12 M9 12h12 M9 18h12 M3 6h1 M3 12h1 M3 18h1',orderedList:'M10 6h11 M10 12h11 M10 18h11 M3 3h2v5 M3 8h4 M3 11h3v2l-3 3h4 M3 19h3v3H3',bible:'M4 3h15v18H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2 M2 17h17 M10 6v8 M7 9h6',check:'m5 12 4 4L20 5',gift:'M3 8h18v4H3z M5 12v9h14v-9 M12 8v13 M12 8C3 8 5 0 9 4l3 4c9 0 7-8 3-4l-3 4',add:'M12 5v14 M5 12h14',chat:'M21 11a9 9 0 0 1-9 9H4l-3 2 2-7a9 9 0 1 1 18-4z M7 9h10 M7 13h7',send:'m4 4 17 8-17 8 3-8-3-8 M7 12h14',pen:'m4 20 4-1 12-12-3-3L5 16l-1 4 M14 7l3 3',highlighter:'m4 16 8-8 6 6-8 8H4v-6 M12 8l3-5 6 6-3 5 M4 20h6',eraser:'m4 13 8-9 9 9-7 7H10l-6-7 M8 9l9 8 M14 20h8',undo:'M9 5 3 11l6 6 M3 11h11a6 6 0 0 1 6 6',redo:'m15 5 6 6-6 6 M21 11H10a6 6 0 0 0-6 6',headphones:'M4 14v-3a8 8 0 0 1 16 0v3 M4 12h3v8H4z M17 12h3v8h-3z',sliders:'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6','chevron-down':'m6 9 6 6 6-6',left:'m15 5-7 7 7 7',right:'m9 5 7 7-7 7',more:'M5 12h.1 M12 12h.1 M19 12h.1',zoom:'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M15 15l6 6 M7 10h6 M10 7v6',cloud:'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 20 10a4 4 0 0 1-1 8H7 M9 13l2 2 4-4',device:'M3 4h18v13H3z M8 21h8 M12 17v4',alert:'M12 3 2 21h20L12 3z M12 9v5 M12 17v1',help:'M9.5 8a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 3 M12 17v.1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',retry:'M20 7v5h-5 M20 12a8 8 0 1 0-2 5'};
export function controlIcon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const[k,v]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(k,v);const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[name]??paths.help);svg.append(p);return svg;}

export function compactDisclosure({label,icon='help',content,portal=false,closeOnSelect=false,onActivate=null,canOpen=()=>true}){
 let hovered=false,hoverDismissed=false,activationPoint=null,hoverClose=null,dead=false;
 const trigger=button(controlIcon(icon),e=>{if(dead)return;return onActivate?onActivate(e):hovered?show():toggle();},'quiet icon-button'),popup=el('div',{class:'compact-popover',hidden:true,role:'note',id:'detail-'+crypto.randomUUID()}),node=el('span',{class:'compact-disclosure'},trigger,popup);
 trigger.setAttribute('aria-label',label);trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',popup.id);
 const paint=()=>{popup.replaceChildren();const value=typeof content==='function'?content():content;popup.append(value instanceof Node?value:document.createTextNode(value??''));};
 function cancelHoverClose(){clearTimeout(hoverClose);hoverClose=null;}
 function place(){
  const v=window.visualViewport,left=v?.offsetLeft??0,top=v?.offsetTop??0,width=v?.width??window.innerWidth,height=v?.height??innerHeight;
  const nav=document.querySelector?.('#mobile-navigation'),navBox=nav?.getBoundingClientRect(),bottom=Math.min(top+height,navBox?.width&&navBox.height?navBox.top:top+height)-12;
  const anchor=trigger.getBoundingClientRect(),start=top+12,gap=6;
  Object.assign(popup.style,{position:'fixed',zIndex:1000,right:'auto',bottom:'auto',transform:'',left:left+12+'px',top:start+'px',maxWidth:Math.max(0,width-24)+'px',maxHeight:Math.max(0,bottom-start)+'px'});
  const box=popup.getBoundingClientRect(),above=Math.max(0,Math.min(bottom-start,anchor.top-gap-start)),below=Math.max(0,Math.min(bottom-start,bottom-anchor.bottom-gap)),up=box.height>below&&above>below,room=up?above:below;
  popup.style.maxHeight=Math.max(0,room)+'px';
  const measured=popup.getBoundingClientRect();
  popup.style.left=Math.max(left+12,Math.min(anchor.right-measured.width,left+width-measured.width-12))+'px';
  popup.style.top=Math.max(start,Math.min(up?anchor.top-gap-measured.height:anchor.bottom+gap,bottom-measured.height))+'px';
 }
 function show(){
  cancelHoverClose();if(dead||!canOpen())return;
  // Every disclosure in a scrolling page toolbar uses the same portal ownership.
  portal=portal||!!trigger.closest?.('.page-heading > .actions');
  if(!popup.hidden){if(portal)place();return;}
  paint();if(portal)document.body.append(popup);popup.hidden=false;popup.style.transform='';
  if(portal)place();else{const box=popup.getBoundingClientRect(),width=window.visualViewport?.width??window.innerWidth,shift=box.left<12?12-box.left:box.right>width-12?width-12-box.right:0;if(shift)popup.style.transform=`translateX(${shift}px)`;}
  trigger.setAttribute('aria-expanded','true');
  if(portal&&trigger.matches?.(':focus-visible'))popup.querySelector('select,input,button,a[href],[tabindex]')?.focus({preventScroll:true});
 }

 function hide(){cancelHoverClose();popup.hidden=true;trigger.setAttribute('aria-expanded','false');}
 function toggle(){popup.hidden?show():hide();}
 // Closing an occluding panel can expose this control to a stationary pointer.
 // Preserve deliberate hover, but wait for real movement after an outside click.
 const stationary=e=>activationPoint&&e.clientX===activationPoint.x&&e.clientY===activationPoint.y;
 node.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){cancelHoverClose();hovered=true;if(!hoverDismissed&&!stationary(e))show();}});
 node.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'&&hovered&&!hoverDismissed&&!stationary(e)){activationPoint=null;if(popup.hidden)show();}});
 // A portal is separated from its trigger by a small layout gap. Allow the
 // pointer to cross it in either direction without discarding the open panel.
 const leave=e=>{if(e.pointerType!=='mouse'||node.contains(e.relatedTarget)||popup.contains(e.relatedTarget))return;hovered=false;hoverDismissed=false;activationPoint=null;cancelHoverClose();if(portal)hoverClose=setTimeout(()=>{hoverClose=null;if(!popup.contains(document.activeElement))hide();},300);else hide();};
 node.addEventListener('pointerleave',leave);{popup.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){cancelHoverClose();hovered=true;}});popup.addEventListener('pointerleave',leave);}
 node.addEventListener('focusout',e=>{if(!node.contains(e.relatedTarget)&&!popup.contains(e.relatedTarget))hide();});if(!portal)trigger.addEventListener('focus',()=>{if(trigger.matches?.(':focus-visible'))show();});popup.addEventListener('focusout',e=>{if(!node.contains(e.relatedTarget)&&!popup.contains(e.relatedTarget))hide();});
 popup.addEventListener('click',e=>{if(closeOnSelect&&e.target.closest?.('button,a'))hide();});
 const viewport=()=>{if(!popup.hidden&&portal)place();};
 const outside=e=>{if(!node.contains(e.target)&&!popup.contains(e.target)){activationPoint=e.pointerType==='mouse'&&Number.isFinite(e.clientX)&&Number.isFinite(e.clientY)?{x:e.clientX,y:e.clientY}:null;hide();}},key=e=>{if(e.key==='Escape'){const open=!popup.hidden;if(open)hoverDismissed=true;hide();if(portal&&open)trigger.focus({preventScroll:true});}};const moved=e=>{if(activationPoint&&e.pointerType==='mouse'&&Number.isFinite(e.clientX)&&Number.isFinite(e.clientY)&&!stationary(e))activationPoint=null;};document.addEventListener('pointerdown',outside);document.addEventListener('pointermove',moved,{passive:true});document.addEventListener('keydown',key);window.addEventListener('resize',hide);window.addEventListener('scroll',viewport,true);window.visualViewport?.addEventListener?.('resize',viewport);window.visualViewport?.addEventListener?.('scroll',viewport);
 return {node,trigger,hide,show,toggle,refresh:()=>{if(!popup.hidden&&!dead){paint();if(portal)place();}},destroy:()=>{dead=true;hide();document.removeEventListener('pointerdown',outside);document.removeEventListener('pointermove',moved);document.removeEventListener('keydown',key);window.removeEventListener('resize',hide);window.removeEventListener('scroll',viewport,true);window.visualViewport?.removeEventListener?.('resize',viewport);window.visualViewport?.removeEventListener?.('scroll',viewport);if(portal)popup.remove();}};
}
export function helpControl(text,label='Help'){return compactDisclosure({label,content:text});}

export function elapsedSave(at,now=Date.now()){
 const seconds=Math.max(0,Math.floor((now-Date.parse(at))/1000));if(!Number.isFinite(seconds))return 'No confirmed save yet';
 if(seconds<60)return `Updated ${seconds} seconds ago`;const minutes=Math.floor(seconds/60);if(minutes<60)return `Updated ${minutes} ${minutes===1?'minute':'minutes'} ago`;const hours=Math.floor(minutes/60);return `Updated ${hours} ${hours===1?'hour':'hours'} ago`;
}
export function syncPresentation(state,presentation={},browserOnly=globalThis.__LIFEOS_BROWSER_DEMO__===true){
 if(browserOnly&&state.mode==='cloud')return {icon:'device',label:'Saved on this device',detail:'Saved in this browser. Nothing is uploaded.'};
 return {icon:presentation.icons?.[state.mode]??state.mode,label:state.label||presentation.labels?.[state.mode]||(state.mode==='cloud'?'Saved to cloud':state.mode==='alert'?'Save needs attention':'Saved on this device'),detail:presentation.details?.[state.mode]??((typeof state.detail==='function'?state.detail():state.detail)||elapsedSave(state.updatedAt))};
}
export function syncControl(onRetry,presentation={}){
 let state={mode:'device',updatedAt:null,detail:'Not yet saved to the cloud',retry:false},retrying=false;
 const disclosure=compactDisclosure({portal:true,label:'Save status',icon:'device',content:()=>el('div',{},el('span',{},syncPresentation(state,presentation).detail),state.retry?button(retrying?'Retrying…':(presentation.retryLabel??'Retry sync'),async()=>{if(retrying)return;retrying=true;disclosure.refresh();try{await onRetry();}finally{retrying=false;disclosure.refresh();}},'text-button'):null)});
 disclosure.node.classList.add('save-indicator');
 return {...disclosure,update(next){state={...state,...next};disclosure.trigger.replaceChildren(controlIcon(syncPresentation(state,presentation).icon));disclosure.trigger.dataset.state=state.mode;disclosure.trigger.setAttribute('aria-label',syncPresentation(state,presentation).label);disclosure.refresh();}};
}
