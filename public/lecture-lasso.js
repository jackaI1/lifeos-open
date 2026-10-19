import {inPolygon} from './lecture-ink-geometry.js';
import {strokePaths,segmentDistance} from './lecture-tools.js';
const box=points=>{let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;for(const p of points){x=Math.min(x,p.x);y=Math.min(y,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}return{x,y,width:Math.max(1,right-x),height:Math.max(1,bottom-y)};};
const overlaps=(a,b)=>a.x<=b.x+b.width&&a.x+a.width>=b.x&&a.y<=b.y+b.height&&a.y+a.height>=b.y;
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function touches(a,b,c,d,r){if(!overlaps({x:Math.min(a.x,b.x)-r,y:Math.min(a.y,b.y)-r,width:Math.abs(a.x-b.x)+2*r,height:Math.abs(a.y-b.y)+2*r},box([c,d])))return false;return cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0||Math.min(segmentDistance(a,c,d),segmentDistance(b,c,d),segmentDistance(c,a,b),segmentDistance(d,a,b))<=r;}
export function lassoSelection(rows,path,{includeInside=true}={}){
 if(path.length<3)return[];const boundary=[...path,path[0]],area=box(path),selected=[];
 for(const row of rows)for(const [type,values]of [['stroke',row.page.strokes],['attachment',row.page.attachments??[]]])for(const value of values){if(value.hidden)continue;const paths=type==='stroke'?(value.highlightRegions?.length?value.highlightRegions.map(p=>[...p,p[0]]):strokePaths(value)):[[{x:value.x,y:value.y},{x:value.x+value.width,y:value.y},{x:value.x+value.width,y:value.y+value.height},{x:value.x,y:value.y+value.height},{x:value.x,y:value.y}]];
  const world=paths.map(p=>p.map(v=>({...v,y:v.y+row.top}))),bounds=box([...world.flat(),...(type==='stroke'?value.points.map(p=>({...p,y:p.y+row.top})):[])]);if(!overlaps(area,bounds))continue;
  const contained=includeInside&&world.some(p=>p.some(v=>inPolygon(v,path))),surface=type==='attachment'&&path.some(p=>inPolygon(p,world[0]));
  if(contained||surface||world.some(p=>p.some((b,i)=>boundary.slice(1).some((d,j)=>touches(p[Math.max(0,i-1)],b,boundary[j],d,(value.width&&type==='stroke'?value.width/2:0)+3)))))selected.push({type,pageId:row.id,top:row.top,pageHeight:row.page.height??1400,value,bounds});
 }return selected;
}
export function selectionBounds(items){return box(items.flatMap(i=>[{x:i.bounds.x,y:i.bounds.y},{x:i.bounds.x+i.bounds.width,y:i.bounds.y+i.bounds.height}]));}
export function transformSelection(items,before,after){const scale=after.width/before.width;return items.map(item=>{const map=p=>({...p,x:after.x+(p.x-before.x)*scale,y:after.y+(p.y+item.top-before.y)*scale-item.top}),a=item.value;let value;
 if(item.type==='attachment'){const p=map(a);value={...a,x:p.x,y:p.y,width:a.width*scale,height:a.height*scale};}
 else{value={...a,points:a.points.map(map),width:Math.max(.5,Math.min(20,a.width*scale))};if(a.shape)value.shape={...a.shape,from:map(a.shape.from),to:map(a.shape.to)};if(a.graph)value.graph={...a.graph,from:map(a.graph.from),to:map(a.graph.to),spacing:Math.max(12,Math.min(200,a.graph.spacing*scale))};if(a.highlightRegions)value.highlightRegions=a.highlightRegions.map(p=>p.map(map));}
 return {...item,value,bounds:{x:after.x+(item.bounds.x-before.x)*scale,y:after.y+(item.bounds.y-before.y)*scale,width:item.bounds.width*scale,height:item.bounds.height*scale}};});}
export function constrainSelection(items,before,after){let scale=Math.max(.05,Math.min(1000/before.width,after.width/before.width));let low=-Infinity,high=Infinity;for(const item of items){const offset=(item.bounds.y-before.y)*scale;low=Math.max(low,item.top-offset);high=Math.min(high,item.top+item.pageHeight-offset-item.bounds.height*scale);}if(low>high)return before;return{...after,width:before.width*scale,height:before.height*scale,x:Math.max(0,Math.min(1000-before.width*scale,after.x)),y:Math.max(low,Math.min(high,after.y))};}
