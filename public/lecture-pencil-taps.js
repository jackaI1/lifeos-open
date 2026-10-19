// CSS-pixel thresholds stay equally strict at every paper zoom.
export const PENCIL_TAPS=Object.freeze({windowMs:240,contactMs:90,radius:5,movement:2,quietMs:180});
export function pencilTapInput({getMode,toggle,start,move,erase,end,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout}){
 let active=null,pending=null,hold=null,wait=null,lastMotion=-Infinity;
 const begin=a=>{if(!a||a.started)return;a.started=true;a.mode==='eraser'?erase(a.down):start(a.down);};
 const finish=a=>{begin(a);end(a.up);};
 function flushPending(){clearTimer(wait);wait=null;if(pending){const p=pending;pending=null;finish(p);}}
 const distance=(a,b)=>Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
 function down(e){flushActive();const at=now(),mode=getMode();if(pending&&(at-pending.at>PENCIL_TAPS.windowMs||distance(e,pending.down)>PENCIL_TAPS.radius||mode!==pending.mode))flushPending();
  const eligible=['pen','eraser'].includes(mode)&&(!!pending||at-lastMotion>=PENCIL_TAPS.quietMs);
  active={down:e,at,mode,eligible,started:false};if(!eligible){flushPending();begin(active);}else hold=setTimer(()=>{flushPending();begin(active);},PENCIL_TAPS.contactMs);
 }
 function moving(e){if(!active)return;const samples=e.getCoalescedEvents?.()??[e];if(samples.some(p=>distance(p,active.down)>PENCIL_TAPS.movement)||distance(e,active.down)>PENCIL_TAPS.movement){active.eligible=false;clearTimer(hold);flushPending();begin(active);}if(active.started)active.mode==='eraser'?erase(e):move(e);}
 function up(e){if(!active)return;clearTimer(hold);hold=null;const a=active;active=null;a.up=e;const at=now();
  if(e.type==='pointercancel'||e.type==='lostpointercapture'){flushPending();if(a.started)end(e);lastMotion=at;return;}
  const brief=a.eligible&&!a.started&&at-a.at<=PENCIL_TAPS.contactMs&&distance(e,a.down)<=PENCIL_TAPS.movement;
  if(!brief){flushPending();finish(a);lastMotion=at;return;}
  if(pending&&at-pending.at<=PENCIL_TAPS.windowMs&&distance(a.down,pending.down)<=PENCIL_TAPS.radius){clearTimer(wait);wait=null;pending=null;lastMotion=at;toggle();return;}
  flushPending();pending=a;wait=setTimer(flushPending,Math.max(0,PENCIL_TAPS.windowMs-(at-a.at)));
 }
 function flushActive(){if(!active)return;clearTimer(hold);flushPending();begin(active);}
 return {down,move:moving,up,flush(){flushPending();flushActive();},destroy(){clearTimer(hold);clearTimer(wait);flushPending();if(active?.started)end(active.down);active=null;}};
}
