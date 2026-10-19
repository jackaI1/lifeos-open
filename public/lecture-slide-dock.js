import {controlIcon} from './quiet-controls.js';
import { el } from './ui.js';
import {dismissOnOutside} from './dialog-position.js';

export function dockBounds(box, viewport) {
  const width = Math.min(Math.max(240, box.width), viewport.width - 16);
  const height = Math.min(Math.max(220, box.height), viewport.height - 16);
  return { width, height,
    x: Math.max(8, Math.min(box.x, viewport.width - width - 8)),
    y: Math.max(8, Math.min(box.y, viewport.height - height - 8)) };
}
export function resizeDock(box,dx,dy,side,viewport){const width=Math.max(240,box.width+(side==='left'?-dx:dx));return dockBounds({...box,width,height:box.height+dy,x:side==='left'?box.x+box.width-width:box.x},viewport);}

export function slideDock(title, body, onclose, options={}) {
  let box = {x: innerWidth - 400, y: 90, width: 380, height: 460}, closed = false,full=false,restoreBox=null,minimized=false,expandedBox=null,expandedFull=false,suppressClick=false;const label=options.label??'slides';
  const move = el('span', {class: 'slide-dock-handle', role: 'button', tabindex: 0,
    'aria-label': 'Move '+label+'. Use arrow keys to move.'}, title);
  const resize = el('span', {class: 'slide-dock-resize', role: 'button', tabindex: 0,
    'aria-label': 'Resize '+label+'. Use arrow keys to resize.'});
  const resizeLeft=el('span',{class:'slide-dock-resize slide-dock-resize-left',role:'button',tabindex:0,'aria-label':'Resize '+label+' from left. Use arrow keys to resize.'});
  const host = el('aside', {class: 'lecture-slide-dock', 'aria-label': title},
    el('div', {class: 'slide-dock-header'}, move,
      el('button', {type:'button',onclick:()=>void close(),class:'quiet icon-button','aria-label':'Close '+label},controlIcon('close'))), body, resizeLeft, resize);
  body.classList.add('slide-dock-content');if(options.className)host.classList.add(options.className);
  const fullButton=el('button',{type:'button',class:'quiet icon-button','aria-label':'Fullscreen '+label,onclick:()=>{if(minimized){minimized=false;box={...expandedBox,x:box.x,y:box.y};full=false;}if(!full)restoreBox={...box};full=!full;if(!full&&restoreBox)box=restoreBox;fullButton.setAttribute('aria-pressed',String(full));fullButton.setAttribute('aria-label',(full?'Restore ':'Fullscreen ')+label);layout();}},controlIcon('expand'));if(options.fullscreen)host.querySelector('.slide-dock-header').insertBefore(fullButton,host.querySelector('.slide-dock-header').lastChild);
  function toggleMinimized(){if(!options.minimize)return;if(!minimized){expandedBox={...(full?restoreBox??box:box)};expandedFull=full;minimized=true;full=false;if(body.contains(document.activeElement))document.activeElement.blur?.();}else{minimized=false;box={...expandedBox,x:box.x,y:box.y};full=expandedFull;}layout();}
  function layout() {
    const view=window.visualViewport,vp={width:view?.width??innerWidth,height:view?.height??innerHeight};host.classList.toggle('is-minimized',minimized);body.hidden=minimized;resize.hidden=resizeLeft.hidden=minimized;
    if(options.minimize){move.setAttribute('aria-expanded',String(!minimized));move.setAttribute('aria-label',(minimized?'Expand ':'Minimize ')+title+'. Drag to move.');}
    if(minimized){Object.assign(host.style,{width:'max-content',height:'auto'});const width=Math.min(host.offsetWidth||title.length*8+112,vp.width-16),height=host.offsetHeight||54;box={...box,width,height,x:Math.max(8,Math.min(box.x,vp.width-width-8)),y:Math.max(8,Math.min(box.y,vp.height-height-8))};}
    else box=full?{x:8,y:8,width:vp.width-16,height:vp.height-16}:dockBounds(box,vp);
    fullButton.setAttribute('aria-pressed',String(full));fullButton.setAttribute('aria-label',(full?'Restore ':'Fullscreen ')+label);
    Object.assign(host.style,{left:box.x+'px',top:(box.y+(view?.offsetTop??0))+'px',width:box.width+'px',height:box.height+'px'});
  }
  if(options.minimize){move.addEventListener('click',e=>{if(suppressClick){suppressClick=false;return;}if(e.detail===0||e.detail===undefined)toggleMinimized();});move.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();toggleMinimized();}});}
  function gesture(control, resizing) {
    let drag = null;
    control.addEventListener('pointerdown', e => {
      if(resizing&&minimized)return;if(resizing&&full)full=false;drag = {x:e.clientX,y:e.clientY,box:{...box},moved:false};
      control.setPointerCapture(e.pointerId); e.preventDefault();
    });
    control.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx=e.clientX-drag.x, dy=e.clientY-drag.y;drag.moved ||=Math.hypot(dx,dy)>5;if(full)return;
      box = resizing ? resizeDock(drag.box,dx,dy,resizing,{width:innerWidth,height:innerHeight}) : {...drag.box,x:drag.box.x+dx,y:drag.box.y+dy};
      layout();
    });
    for(const name of ['pointerup','pointercancel','lostpointercapture'])control.addEventListener(name,e=>{const prior=drag;drag=null;if(prior&&name==='pointerup'&&!resizing&&options.minimize){suppressClick=true;setTimeout(()=>suppressClick=false,500);if(!prior.moved)toggleMinimized();}});
    control.addEventListener('keydown', e => {
      if(full&&!resizing||resizing&&minimized||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
      e.preventDefault();if(resizing&&full)full=false;
      const dx=e.key==='ArrowLeft'?-20:e.key==='ArrowRight'?20:0;
      const dy=e.key==='ArrowUp'?-20:e.key==='ArrowDown'?20:0;
      if(resizing)box=resizeDock(box,dx,dy,resizing,{width:innerWidth,height:innerHeight});else{box.x+=dx;box.y+=dy;}layout();
    });
  }
  const stopDismiss=dismissOnOutside(host,()=>close(),{enabled:()=>!closed&&!document.querySelector('#dialog')?.open});
  let closing=false;
  async function close(force=false) { if(closed||closing&&!force)return;closing=true;try{if(!force&&options.beforeClose&&!await options.beforeClose())return;if(closed)return;closed=true;stopDismiss();window.removeEventListener('resize',layout);window.visualViewport?.removeEventListener('resize',layout);host.remove();onclose?.();}finally{closing=false;} }
  gesture(move,false);gesture(resize,'right');gesture(resizeLeft,'left');window.addEventListener('resize',layout);window.visualViewport?.addEventListener('resize',layout);
  document.body.append(host);layout();
  return {close,element:host,toggleMinimized};
}
