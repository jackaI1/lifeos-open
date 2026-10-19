export const paperBottom=page=>Math.max(...(page.attachments??[]).map(a=>a.y+a.height),page.strokes.filter(s=>!s.hidden).reduce((max,s)=>s.points.reduce((m,p)=>Math.max(m,p.y),max),0));
// Deliberate compact back-and-forth gesture only; enabled explicitly in the tool menu.
export function scribbleTargets(gesture,strokes){
 const p=gesture.points;if(p.length<12||gesture.endedAtOffsetMs-gesture.startedAtOffsetMs>1600)return [];
 const xs=p.map(v=>v.x),ys=p.map(v=>v.y),lo=Math.min(...xs),hi=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
 if(hi-lo<25||hi-lo>220||bottom-top>100)return [];
 let turns=0,last=0,anchor=p[0].x;for(const point of p){const dx=point.x-anchor;if(Math.abs(dx)<12)continue;const sign=Math.sign(dx);if(last&&last!==sign)turns++;last=sign;anchor=point.x;}
 if(turns<5)return [];
 return strokes.filter(s=>!s.hidden&&s.points.some(v=>v.x>=lo&&v.x<=hi&&v.y>=top-8&&v.y<=bottom+8)).map(s=>s.id);
}
// A quiet room is not a recording failure. Warn without stopping or deleting audio.
export function quietMicrophone(level,quietForMs){return Number.isFinite(level)&&level<=0.02&&quietForMs>=20000;}
