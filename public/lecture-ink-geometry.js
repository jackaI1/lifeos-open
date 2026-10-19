// Rendering helpers keep raw Pencil samples intact. Display geometry is disposable.
const boundsCache=new WeakMap();
export function inkBounds(stroke){let b=boundsCache.get(stroke);if(b&&b.count===stroke.points.length)return b;let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;for(const p of stroke.points){left=Math.min(left,p.x);right=Math.max(right,p.x);top=Math.min(top,p.y);bottom=Math.max(bottom,p.y);}b={left,right,top,bottom,count:stroke.points.length};boundsCache.set(stroke,b);return b;}
export function visibleStrokes(strokes,top,bottom){return strokes.filter(s=>!s.hidden&&inkBounds(s).bottom+(s.width??3)>=top&&inkBounds(s).top-(s.width??3)<=bottom);}
export function inPolygon(point,polygon){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
export function convexHull(points){const p=points.map(({x,y})=>({x,y})).sort((a,b)=>a.x-b.x||a.y-b.y);if(p.length<3)return p;const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),lower=[],upper=[];for(const v of p){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),v)<=0)lower.pop();lower.push(v);}for(const v of p.toReversed()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),v)<=0)upper.pop();upper.push(v);}lower.pop();upper.pop();return lower.concat(upper);}
export function fittedHighlight(gesture,strokes){
 const p=gesture.points;if(p.length<10)return null;const b=inkBounds(gesture),span=Math.max(b.right-b.left,b.bottom-b.top);if(span<20||Math.hypot(p[0].x-p.at(-1).x,p[0].y-p.at(-1).y)>Math.max(24,span*.28))return null;
 const polygon=p.filter((_,i)=>i%Math.max(1,Math.ceil(p.length/64))===0);
 const selected=strokes.filter(s=>{if(s.hidden||s.intent&&s.intent!=='ink')return false;const box=inkBounds(s);if(box.right<b.left||box.left>b.right||box.bottom<b.top||box.top>b.bottom)return false;return s.points.filter(x=>inPolygon(x,polygon)).length>=Math.ceil(s.points.length*.6);});if(!selected.length)return null;
 const rows=[];for(const s of selected.sort((a,b)=>inkBounds(a).top-inkBounds(b).top||inkBounds(a).left-inkBounds(b).left)){const b=inkBounds(s);let row=rows.find(r=>b.top<=r.bottom+5&&b.bottom>=r.top-5);if(!row){row={top:b.top,bottom:b.bottom,strokes:[]};rows.push(row);}row.top=Math.min(row.top,b.top);row.bottom=Math.max(row.bottom,b.bottom);row.strokes.push(s);}
 const regions=[];for(const row of rows){let group=[];const finish=()=>{if(!group.length)return;const points=group.flatMap(s=>{const b=inkBounds(s),pad=Math.max(5,(s.width??3)*2);return [{x:b.left-pad,y:b.top-pad},{x:b.right+pad,y:b.top-pad},{x:b.right+pad,y:b.bottom+pad},{x:b.left-pad,y:b.bottom+pad}];});regions.push(convexHull(points).map(p=>({x:Math.max(0,Math.min(1000,p.x)),y:Math.max(0,p.y)})));group=[];};for(const s of row.strokes.sort((a,b)=>inkBounds(a).left-inkBounds(b).left)){if(group.length&&inkBounds(s).left-inkBounds(group.at(-1)).right>35)finish();group.push(s);}finish();}return {regions,strokeIds:selected.map(s=>s.id)};
}
export function scribbleEraseTargets(gesture,strokes){
 const p=gesture.points;if(p.length<10||gesture.endedAtOffsetMs-gesture.startedAtOffsetMs>2600)return [];
 const b=inkBounds(gesture),horizontal=b.right-b.left>=b.bottom-b.top,axis=horizontal?'x':'y',span=horizontal?b.right-b.left:b.bottom-b.top,crossSpan=horizontal?b.bottom-b.top:b.right-b.left;if(span<24||span>600||crossSpan>Math.max(130,span*.8))return [];
 let direction=0,anchor=p[0][axis],turns=0,length=0;for(let i=1;i<p.length;i++){length+=Math.hypot(p[i].x-p[i-1].x,p[i].y-p[i-1].y);const d=p[i][axis]-anchor;if(Math.abs(d)<Math.max(10,span*.22))continue;const sign=Math.sign(d);if(direction&&sign!==direction)turns++;direction=sign;anchor=p[i][axis];}
 if(turns<4||length<span*3.3)return [];
 return strokes.filter(s=>!s.hidden&&s.points.some(v=>v.x>=b.left-6&&v.x<=b.right+6&&v.y>=b.top-8&&v.y<=b.bottom+8)).map(s=>s.id);
}
export const INK_COLORS=Object.freeze(['#152b43','#2465a8','#ad3e43','#257b59','#70539c','#a6632a']);
