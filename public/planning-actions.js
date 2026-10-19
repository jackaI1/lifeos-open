export function moveConsequences(item,values,timeline){
 const start=Date.parse(values.start??item.start),end=Date.parse(values.end??item.end??values.start??item.start);return timeline.filter(other=>other.id!==item.id&&!['completed','observed','past-plan'].includes(other.state)&&other.end&&Date.parse(other.start)<end&&Date.parse(other.end)>start).map(other=>({id:other.id,title:other.title,start:other.start,end:other.end,protected:other.kind==='calendar'||['sleep','dinner','lunch','breakfast','fellowship','commute'].includes(other.kind)}));
}
export function replanRemaining(timeline,now){
 const time=new Date(now).getTime(),protectedItems=timeline.filter(i=>i.kind==='calendar'||['sleep','dinner','lunch','breakfast','commute','fellowship','travel'].includes(i.kind)||['completed','observed'].includes(i.state)),changes=[];let cursor=time;
 for(const item of timeline.filter(i=>!protectedItems.includes(i)&&!i.hidden&&['devotional','prayer','school','exercise','project','reminder'].includes(i.kind)&&['planned','past-plan','current'].includes(i.state))){
  const length=Date.parse(item.end)-Date.parse(item.start);if(!Number.isFinite(length)||length<=0)continue;let start=Math.max(cursor,Date.parse(item.start));
  for(const fixed of protectedItems.filter(i=>i.end).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))){if(Date.parse(fixed.end)>start&&Date.parse(fixed.start)<start+length)start=Date.parse(fixed.end);}
  const end=start+length;if(end>time+12*3600000)continue;if(start!==Date.parse(item.start))changes.push({entryId:item.id,title:item.title,from:item.start,start:new Date(start).toISOString(),end:new Date(end).toISOString()});cursor=end;
 }return changes;
}
