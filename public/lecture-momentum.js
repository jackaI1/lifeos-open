// Screen-pixel velocity keeps the same feel at every paper zoom and refresh rate.
const MOTION={sampleWindow:100,releaseWindow:90,minSpeed:.04,maxSpeed:3,decayMs:240,maxFrameGap:80};
export function lectureMomentum(scroll,{now=()=>performance.now(),requestFrame=fn=>globalThis.requestAnimationFrame?.(fn),cancelFrame=id=>globalThis.cancelAnimationFrame?.(id),reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false}={}){
 let frame=null,samples=[],vx=0,vy=0,last=0;
 const point=()=>({x:scroll.scrollLeft,y:scroll.scrollTop,t:now()});
 function stop(){if(frame!=null)cancelFrame(frame);frame=null;samples=[];vx=vy=0;}
 function begin(){stop();samples=[point()];}
 function sample(){const p=point();samples.push(p);while(samples.length>2&&samples[0].t<p.t-MOTION.sampleWindow)samples.shift();}
 function step(){
  frame=null;const t=now(),dt=t-last;last=t;
  if(dt<=0||dt>MOTION.maxFrameGap||reducedMotion()){stop();return;}
  const decay=Math.exp(-dt/MOTION.decayMs),distance=MOTION.decayMs*(1-decay),x=scroll.scrollLeft,y=scroll.scrollTop;
  scroll.scrollLeft=x+vx*distance;scroll.scrollTop=y+vy*distance;
  vx=Math.abs(scroll.scrollLeft-x)<.1?0:vx*decay;vy=Math.abs(scroll.scrollTop-y)<.1?0:vy*decay;
  if(Math.hypot(vx,vy)<MOTION.minSpeed){stop();return;}
  frame=requestFrame(step);
 }
 function release(){
  if(reducedMotion()||samples.length<2)return;
  const first=samples[0],end=samples.at(-1),elapsed=end.t-first.t;
  if(elapsed<=0||now()-end.t>MOTION.releaseWindow)return;
  vx=(end.x-first.x)/elapsed;vy=(end.y-first.y)/elapsed;
  const speed=Math.hypot(vx,vy);if(speed<MOTION.minSpeed)return;
  if(speed>MOTION.maxSpeed){vx*=MOTION.maxSpeed/speed;vy*=MOTION.maxSpeed/speed;}
  last=now();samples=[];frame=requestFrame(step);
 }
 return {begin,sample,release,stop};
}
