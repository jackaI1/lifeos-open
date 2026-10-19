export function shiftDay(day,amount){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10);}
export function chronologicalCards(view){
 const now=Date.parse(view.now),ordered=[...(view.carouselTimeline??view.timeline??[])].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)),past=ordered.filter(e=>Date.parse(e.end??e.start)<=now),future=ordered.filter(e=>Date.parse(e.start)>now);
 if(view.upcoming&&!future.some(e=>e.kind===view.upcoming.kind&&e.start===view.upcoming.start))future.push(view.upcoming);
 const sleep=ordered.find(e=>e.kind==='sleep'&&Date.parse(e.start)<=now&&Date.parse(e.end)>now);const afterPractice=view.upcoming?.kind==='prayer'?view.upcoming.end:view.nowAction?.end;if(sleep&&!future.some(e=>e.kind==='sleep'&&e.start===afterPractice)&&['prayer','devotional'].includes(view.nowAction?.kind)&&afterPractice&&Date.parse(afterPractice)<Date.parse(sleep.end))future.push({...sleep,start:afterPractice,position:'Next'});
 future.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 return {items:[...past.map(e=>({...e,position:'Previous'})),{...view.nowAction,position:'Now'},...future.map(e=>({...e,position:'Next'}))],current:past.length};
}
export function swipeDays(node,move){
 let start,ignoreClickUntil=0;if(node.style){node.style.touchAction='pan-y pinch-zoom';node.style.overscrollBehaviorX='contain';}
 const editing=e=>['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable||e.target.closest?.('.schedule-drag');
 node.addEventListener('touchstart',e=>{if(editing(e)){start=null;return;}const p=e.changedTouches[0];start={x:p.clientX,y:p.clientY};},{passive:true});
 node.addEventListener('touchcancel',()=>{start=null;},{passive:true});
 node.addEventListener('touchend',e=>{if(!start)return;const p=e.changedTouches[0],x=p.clientX-start.x,y=p.clientY-start.y;start=null;if(Math.abs(x)>65&&Math.abs(x)>Math.abs(y)*1.5){ignoreClickUntil=Date.now()+350;move(x<0?1:-1);}},{passive:true});
 node.addEventListener('click',e=>{if(Date.now()<ignoreClickUntil){e.preventDefault();e.stopPropagation();}},true);
}
