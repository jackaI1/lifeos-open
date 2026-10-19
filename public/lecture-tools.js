// Derived display geometry. Original samples and their audio offsets remain untouched.
export const PAPER_LINE_SPACING=36;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function segmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return distance(p,{x:a.x+dx*t,y:a.y+dy*t});}
export function renderSamples(points){if(!points.some(p=>p.pressure>.001))return points.map(p=>({...p,pressure:.5}));let end=points.length;while(end>1&&points[end-1].pressure<=.001)end--;return points.slice(0,end);}
export function fitHeldShape(samples){
 const points=renderSamples(samples);if(points.length<4)return null;
 const first=points[0],last=points.at(-1),length=distance(first,last),xs=points.map(p=>p.x),ys=points.map(p=>p.y),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys),w=right-left,h=bottom-top,span=Math.max(w,h);
 if(span<24)return null;
 if(length>span*.65&&points.reduce((n,p)=>n+segmentDistance(p,first,last),0)/points.length<Math.max(3,span*.075))return {type:'line',from:{x:first.x,y:first.y},to:{x:last.x,y:last.y}};
 if(distance(first,last)>span*.28||w<16||h<16)return null;
 const cx=(left+right)/2,cy=(top+bottom)/2,ellipseError=points.reduce((n,p)=>n+Math.abs(Math.hypot((p.x-cx)/(w/2),(p.y-cy)/(h/2))-1),0)/points.length;
 const edgeError=points.reduce((n,p)=>n+Math.min(Math.abs(p.x-left),Math.abs(p.x-right),Math.abs(p.y-top),Math.abs(p.y-bottom)),0)/points.length;
 if(edgeError<span*.035&&ellipseError>.08)return {type:'rectangle',from:{x:left,y:top},to:{x:right,y:bottom}};
 if(ellipseError<.19)return {type:'ellipse',from:{x:left,y:top},to:{x:right,y:bottom}};
 return null;
}
export function shapePath(shape){
 const a=shape.from,b=shape.to;if(shape.type==='line')return [a,b];
 if(shape.type==='rectangle')return [a,{x:b.x,y:a.y},b,{x:a.x,y:b.y},a];
 if(shape.type==='ellipse'){const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;return Array.from({length:65},(_,i)=>({x:cx+(b.x-a.x)/2*Math.cos(i*Math.PI/32),y:cy+(b.y-a.y)/2*Math.sin(i*Math.PI/32)}));}
 throw Error('Unsupported shape');
}
export class ShapeHold{
 constructor({changed=()=>{},setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){Object.assign(this,{changed,setTimer,clearTimer});}
 move(stroke){const last=stroke.points.at(-1);if(this.stroke===stroke&&this.anchor&&distance(last,this.anchor)<2)return;this.stop();this.stroke=stroke;this.anchor={x:last.x,y:last.y};if(stroke.shape){delete stroke.shape;this.changed(stroke);}this.timer=this.setTimer(()=>{this.timer=null;const shape=fitHeldShape(stroke.points);if(shape){stroke.shape=shape;this.changed(stroke);}},1000);}
 stop(){if(this.timer!=null)this.clearTimer(this.timer);this.timer=null;this.anchor=null;this.stroke=null;}
}
export function graphPaths(graph){
 const {from,to,dimensions=2,negatives=false,spacing=PAPER_LINE_SPACING}=graph;if(![1,2,3].includes(dimensions)||!Number.isFinite(spacing)||spacing<12||spacing>200)throw Error('Invalid graph options');
 const l=Math.min(from.x,to.x),r=Math.max(from.x,to.x),t=Math.min(from.y,to.y),b=Math.max(from.y,to.y),w=r-l,h=b-t,extent=Math.min(w,h)*.4,origin={x:negatives?(l+r)/2:dimensions===3?l+extent*Math.SQRT1_2:l,y:dimensions===1?(t+b)/2:negatives?(t+b)/2:dimensions===3?b-extent*Math.SQRT1_2:b},out=[];
 const axis=(a,b)=>{const line=[a,b];line.axis=true;out.push(line);const length=distance(a,b),ux=(b.x-a.x)/(length||1),uy=(b.y-a.y)/(length||1),end=b;out.push([{x:end.x-ux*9+uy*4,y:end.y-uy*9-ux*4},end,{x:end.x-ux*9-uy*4,y:end.y-uy*9+ux*4}]);return{ux,uy};};
 const ticks=(direction,positive,negative)=>{for(const sign of negative?[1,-1]:[1])for(let n=spacing;n<positive[sign===1?0:1]-8;n+=spacing){const p={x:origin.x+direction.x*n*sign,y:origin.y+direction.y*n*sign};out.push([{x:p.x-direction.y*4,y:p.y+direction.x*4},{x:p.x+direction.y*4,y:p.y-direction.x*4}]);}};
 axis(negatives?{x:l,y:origin.y}:origin,{x:r,y:origin.y});ticks({x:1,y:0},[r-origin.x,origin.x-l],negatives);
 if(dimensions>=2){axis(negatives?{x:origin.x,y:b}:origin,{x:origin.x,y:t});ticks({x:0,y:-1},[origin.y-t,b-origin.y],negatives);}
 if(dimensions===3){const v={x:-Math.SQRT1_2,y:Math.SQRT1_2};axis(negatives?{x:origin.x-v.x*extent,y:origin.y-v.y*extent}:origin,{x:origin.x+v.x*extent,y:origin.y+v.y*extent});ticks(v,[extent,extent],negatives);}
 return out;
}
export function strokePaths(stroke){return stroke.graph?graphPaths(stroke.graph):[stroke.shape?shapePath(stroke.shape):renderSamples(stroke.points)];}
export function strokeNear(stroke,path,radius){const reach=radius+(stroke.width??1)/2;return strokePaths(stroke).some(points=>path.some(p=>points.length===1?distance(p,points[0])<=reach:points.slice(1).some((b,i)=>segmentDistance(p,points[i],b)<=reach)));}
const interpolate=(a,b,t)=>Object.fromEntries(Object.keys(a).map(k=>[k,typeof a[k]==='number'?a[k]+((b[k]??a[k])-a[k])*t:a[k]]));
// Circle/segment intersections retain interpolated audio offsets at the cut edges.
export function eraseFragments(stroke,centres,radius){
 if(stroke.graph)return graphPaths(stroke.graph).flatMap(path=>eraseFragments({...stroke,graph:undefined,points:path.map((p,i)=>({...interpolate(stroke.points[0],stroke.points.at(-1),i/(path.length-1)),...p}))},centres,radius));
 const samples=stroke.shape?shapePath(stroke.shape).map((p,i,a)=>({...interpolate(stroke.points[0],stroke.points.at(-1),i/(a.length-1)),...p})):renderSamples(stroke.points),r=radius+(stroke.width??1)/2;
 if(samples.length===1)return centres.some(c=>distance(c,samples[0])<=r)?[]:[samples];
 const fragments=[];let current=[];
 for(let i=1;i<samples.length;i++){const a=samples[i-1],b=samples[i],dx=b.x-a.x,dy=b.y-a.y,A=dx*dx+dy*dy,marks=[0,1];
  if(!A)continue;for(const c of centres){const ox=a.x-c.x,oy=a.y-c.y,B=2*(ox*dx+oy*dy),C=ox*ox+oy*oy-r*r,D=B*B-4*A*C;if(D>=0)for(const t of [(-B-Math.sqrt(D))/(2*A),(-B+Math.sqrt(D))/(2*A)])if(t>0&&t<1)marks.push(t);}
  marks.sort((a,b)=>a-b);for(let j=1;j<marks.length;j++){const lo=marks[j-1],hi=marks[j];if(hi-lo<1e-8)continue;const middle=interpolate(a,b,(lo+hi)/2),removed=centres.some(c=>distance(c,middle)<=r);if(removed){if(current.length){fragments.push(current);current=[];}}else{const start=interpolate(a,b,lo),end=interpolate(a,b,hi);if(!current.length||distance(current.at(-1),start)>.001)current.push(start);current.push(end);}}
 }
 if(current.length)fragments.push(current);return fragments;
}
