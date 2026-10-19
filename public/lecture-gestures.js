import {pencilTapInput} from './lecture-pencil-taps.js';
import {lectureMomentum} from './lecture-momentum.js';
// Pencil owns ink. Fingers only navigate the paper, including an anchored pinch.
export function bindLectureGestures({canvas,scroll,getMode,getTouchInk=()=>false,getZoom,setZoom,canWrite,start,move,end,erase,listen,imageInput,onDoubleTap,now=()=>performance.now(),motionOptions={}}) {
  const momentum=lectureMomentum(scroll,{now,...motionOptions});
  const taps=onDoubleTap?pencilTapInput({getMode,toggle:onDoubleTap,start,move,end,erase,now}):null;
  const touches=new Map(),listeners=[];let pen=null,gesture=null,editingPointer=null;
  const surface=scroll.addEventListener?scroll:canvas;
  const on=(name,fn)=>{surface.addEventListener(name,fn);listeners.push([name,fn]);};
  const capture=id=>{try{surface.setPointerCapture(id);}catch{}};
  function anchor(){const values=[...touches.values()];if(values.length>=2){momentum.stop();const[a,b]=values;gesture={kind:'pinch',distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),x:(a.x+b.x)/2,y:(a.y+b.y)/2,zoom:getZoom(),moved:true};}else if(values.length){momentum.begin();const a=values[0];gesture={kind:'pan',x:a.x,y:a.y,top:scroll.scrollTop,left:scroll.scrollLeft,moved:false};}else gesture=null;}
  on('pointerdown',e=>{
    momentum.stop();
    if(e.target?.closest?.('button,input,select,textarea,a,[role=button]')&&!e.target?.closest?.('[data-image-handle]'))return;
    if(e.pointerType==='touch'&&!getTouchInk()){e.preventDefault();if(pen!==null||editingPointer!==null)return;taps?.flush();touches.set(e.pointerId,{x:e.clientX,y:e.clientY});capture(e.pointerId);if(touches.size>1){if(gesture?.kind==='image')imageInput?.cancel();anchor();}else if(canWrite()&&imageInput?.start(e))gesture={kind:'image'};else anchor();return;}
    if(e.pointerType!=='pen'&&e.pointerType!=='mouse'&&!(e.pointerType==='touch'&&getTouchInk())){if(canWrite()&&imageInput?.start(e)){e.preventDefault();editingPointer=e.pointerId;capture(e.pointerId);}else if(getMode()==='listen')listen(e);return;}
    e.preventDefault();if(gesture?.kind==='image')imageInput?.cancel();touches.clear();gesture=null;
    if(pen!==null||editingPointer!==null)return;
    if(canWrite()&&imageInput?.beforePen(e)){editingPointer=e.pointerId;capture(e.pointerId);return;}
    if(getMode()==='listen'){listen(e);return;}if(!canWrite())return;
    pen=e.pointerId;capture(pen);if(taps)taps.down(e);else getMode()==='eraser'?erase(e):start(e);
  });
  on('pointermove',e=>{
    if(editingPointer===e.pointerId){e.preventDefault();if(e.buttons===0){imageInput.end(e);editingPointer=null;}else imageInput.move(e);return;}
    if(touches.has(e.pointerId)){touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pen!==null||!gesture)return;e.preventDefault();
      if(gesture.kind==='image'){imageInput.move(e);return;}
      if(gesture.kind==='pinch'){const[a,b]=[...touches.values()];if(!b)return;const distance=Math.hypot(a.x-b.x,a.y-b.y);const x=(a.x+b.x)/2,y=(a.y+b.y)/2;setZoom(getZoom()*distance/gesture.distance,{clientX:gesture.x,clientY:gesture.y});scroll.scrollLeft+=gesture.x-x;scroll.scrollTop+=gesture.y-y;gesture={...gesture,distance:Math.max(1,distance),x,y};}
      else{if(Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>8)gesture.moved=true;scroll.scrollTop=gesture.top+gesture.y-e.clientY;scroll.scrollLeft=gesture.left+gesture.x-e.clientX;momentum.sample();}return;}
    if(pen!==e.pointerId)return;
    if(e.buttons===0){taps?taps.up(e):end(e);pen=null;return;}e.preventDefault();if(taps)taps.move(e);else getMode()==='eraser'?erase(e):move(e);
  });
  const finish=e=>{if(editingPointer===e.pointerId){e.type==='pointerup'?imageInput.end(e):imageInput.cancel();editingPointer=null;}if(pen===e.pointerId){taps?taps.up(e):end(e);pen=null;}if(touches.has(e.pointerId)){if(gesture?.kind==='image')e.type==='pointerup'?imageInput.end(e):imageInput.cancel();else if(e.type==='pointerup'&&gesture?.kind==='pan'){if(gesture.moved&&touches.size===1)momentum.release();else if(!gesture.moved){const selected=imageInput?.tap?.(e);if(!selected&&getMode()==='listen')listen(e);}}else momentum.stop();touches.delete(e.pointerId);anchor();}};
  for(const name of ['pointerup','pointercancel','lostpointercapture'])on(name,finish);
  // Stop before any new interaction, including toolbar controls outside the paper.
  const doc=scroll.ownerDocument,interrupts=['pointerdown','wheel','keydown','visibilitychange'];
  for(const name of interrupts)doc?.addEventListener(name,momentum.stop,true);
  const dispose=()=>{momentum.stop();taps?.destroy();for(const[name,fn]of listeners)surface.removeEventListener(name,fn);for(const name of interrupts)doc?.removeEventListener(name,momentum.stop,true);touches.clear();};dispose.flushPending=()=>{momentum.stop();taps?.flush();};return dispose;
}
