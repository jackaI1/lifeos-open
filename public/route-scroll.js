// iOS can restore its pre-keyboard scroll after a route has already mounted.
// Follow only that short viewport transition, and stop as soon as the owner interacts.
export function settleRouteTop({win=window,doc=document,duration=800}={}){
 const route=win.location.hash;let stopped=false,frame=null,timer;
 const stop=()=>{if(stopped)return;stopped=true;clearTimeout(timer);if(frame!==null)win.cancelAnimationFrame(frame);for(const type of ['resize','scroll'])win.visualViewport?.removeEventListener(type,schedule);for(const type of ['pointerdown','touchmove','wheel','keydown','focusin'])doc.removeEventListener(type,interacted,true);};
 const interacted=e=>{if(e.type!=='focusin'||e.target?.matches?.('input,textarea,[contenteditable=true]'))stop();};
 const paint=()=>{frame=null;if(stopped||win.location.hash!==route||doc.querySelector('#dialog')?.open)return stop();if(doc.activeElement?.matches?.('input,textarea,[contenteditable=true]'))return stop();win.scrollTo({top:0,left:0,behavior:'instant'});};
 function schedule(){if(!stopped&&frame===null)frame=win.requestAnimationFrame(paint);}
 for(const type of ['pointerdown','touchmove','wheel','keydown','focusin'])doc.addEventListener(type,interacted,true);for(const type of ['resize','scroll'])win.visualViewport?.addEventListener(type,schedule);timer=setTimeout(stop,duration);schedule();return stop;
}
