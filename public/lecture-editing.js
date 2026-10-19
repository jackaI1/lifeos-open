export function growBlankPage(height,y,step){
 if(!Number.isFinite(step)||step<=0||y<height-step)return height;
 return Math.min(1000000,height+(Math.floor((y-(height-step))/step)+1)*step);
}
export function splitAcrossPages(a,b,layout){
 const cuts=[0,1],dy=b.y-a.y;if(dy)for(const p of layout)for(const y of [p.top,p.top+p.height]){const t=(y-a.y)/dy;if(t>0&&t<1)cuts.push(t);}
 const values=[...new Set(cuts)].sort((x,y)=>x-y),point=t=>Object.fromEntries(Object.keys(a).map(k=>[k,typeof a[k]==='number'&&typeof b[k]==='number'?a[k]+(b[k]-a[k])*t:b[k]]));
 const segments=[];for(let i=1;i<values.length;i++){const from=point(values[i-1]),to=point(values[i]),middle=(from.y+to.y)/2,p=layout.find(p=>middle>=p.top&&middle<p.top+p.height);if(p)segments.push({pageId:p.id,from:{...from,y:Math.max(0,Math.min(p.height,from.y-p.top))},to:{...to,y:Math.max(0,Math.min(p.height,to.y-p.top))}});}return segments;
}
export function undoInsertedPages(previous,current){return {...previous,pageIds:[...previous.pageIds,...current.pageIds.filter(id=>!previous.pageIds.includes(id))],hidden:[...new Set([...previous.hidden,...current.pageIds.filter(id=>!previous.pageIds.includes(id))])]};}
