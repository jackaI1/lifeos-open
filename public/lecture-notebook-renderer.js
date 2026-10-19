import {InkRenderer} from './lecture-ink-renderer.js';
// One screen-sized canvas. Each visible page keeps its own local ink coordinates.
export class NotebookRenderer{
 constructor({canvas,paintPaper,getPage,needPage}){Object.assign(this,{canvas,paintPaper,getPage,needPage});this.context=canvas.getContext('2d');this.children=new Map();this.pending=new Set();this.retryAt=new Map();this.frame=null;this.dead=false;this.layout=null;}
 child(id,page){let renderer=this.children.get(id);if(!renderer){renderer=new InkRenderer({canvas:document.createElement('canvas'),paintPaper:(ctx,v)=>this.paintPaper(ctx,v,renderer.page),frame:()=>1,cancelFrame(){}});this.children.set(id,renderer);}if(renderer.page!==page)renderer.setPage(page);return renderer;}
 get active(){return this.child(this.pageId,this.page);}
 get strokes(){return this.active.strokes;}
 get preview(){return this.active.preview;}
 setPage(page,id){this.page=page;this.pageId=id??this.pageId??'0001';this.active;this.render(null);}
 setNotebook(layout){this.layout=layout;this.invalidate();}
 visible(){if(!this.viewport)return [];this.updateChild(this.active,this.pageId);return this.active.visible();}
 updateChild(child,id){const entry=this.layout?.find(e=>e.id===id);child.setViewport({...this.viewport,top:this.viewport.top-(entry?.top??0)*this.viewport.scale});}
 setViewport(v){this.viewport=v;const ratio=Math.min(v.pixelRatio??devicePixelRatio??1,2,Math.sqrt(4000000/(v.width*v.height)));this.ratio=ratio;const w=Math.max(1,Math.round(v.width*ratio)),h=Math.max(1,Math.round(v.height*ratio));this.canvas.style.width=v.width+'px';this.canvas.style.height=v.height+'px';if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}this.render(this.live);}
 add(stroke){this.active.index(stroke);this.active.dirty=true;this.render(null);}
 setPlaying(id){this.playing=id;for(const child of this.children.values())if(child.playing!==id){child.playing=id;child.dirty=true;}this.render(this.live);}
 invalidate(){for(const child of this.children.values())child.dirty=true;this.render(this.live);}
 render(live=null){this.live=live;if(this.dead||this.frame!==null)return;this.frame=requestAnimationFrame(()=>{this.frame=null;this.paint();});}
 paint(){if(this.dead||!this.viewport||!this.page)return;const ctx=this.context,v=this.viewport,r=this.ratio,top=v.top/v.scale,bottom=(v.top+v.height)/v.scale,entries=(this.layout??[{id:this.pageId,top:0,height:this.page.height}]).filter(e=>e.top+e.height>=top&&e.top<=bottom),used=new Set(entries.map(e=>e.id));ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#253446';ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
  for(const entry of entries){const page=entry.id===this.pageId?this.page:this.getPage(entry.id);if(!page){if(!this.pending.has(entry.id)&&Date.now()>=(this.retryAt.get(entry.id)??0)){this.pending.add(entry.id);Promise.resolve(this.needPage(entry.id)).catch(()=>this.retryAt.set(entry.id,Date.now()+30000)).finally(()=>{this.pending.delete(entry.id);this.render(this.live);});}ctx.fillStyle='#e5e7e7';ctx.fillRect(v.center*r,(entry.top*v.scale-v.top)*r,1000*v.scale*r,entry.height*v.scale*r);ctx.fillStyle='#253446';ctx.font=(16*r)+'px system-ui';ctx.fillText('Loading notes…',24*r,Math.max(36*r,(entry.top*v.scale-v.top+36)*r));continue;}
   const child=this.child(entry.id,page);this.updateChild(child,entry.id);if(child.dirty)child.paintBase();ctx.save();ctx.beginPath();ctx.rect(0,(entry.top*v.scale-v.top)*r,this.canvas.width,entry.height*v.scale*r);ctx.clip();ctx.drawImage(child.back,0,0);if(entry.id===this.pageId&&this.live){child.transform(ctx);child.paintStroke(ctx,this.live,true);}ctx.restore();
  }
  for(const[id,child]of this.children)if(this.children.size>5&&id!==this.pageId&&!used.has(id)){child.destroy();this.children.delete(id);}
 }
 destroy(){this.dead=true;if(this.frame!==null)cancelAnimationFrame(this.frame);for(const child of this.children.values())child.destroy();this.children.clear();}
}
